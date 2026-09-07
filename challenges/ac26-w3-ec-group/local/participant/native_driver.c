#define PY_SSIZE_T_CLEAN
#include <Python.h>
#include <stdio.h>
#include <stdlib.h>

/* The parent still owns all mathematical checks. This driver only observes the
 * actual exception returned by a Python call and constructs its response outside
 * Python frames. It does not authenticate a process that writes its own protocol.
 */
static int send_value(PyObject *encoder, PyObject *value) {
    PyObject *chunks = PyObject_CallFunction(encoder, "Oi", value, 0);
    if (!chunks) return -1;
    PyObject *empty = PyUnicode_FromString("");
    PyObject *text = empty ? PyUnicode_Join(empty, chunks) : NULL;
    Py_XDECREF(empty); Py_DECREF(chunks);
    if (!text) return -1;
    Py_ssize_t length;
    const char *bytes = PyUnicode_AsUTF8AndSize(text, &length);
    int failed = !bytes || fwrite(bytes, 1, (size_t)length, stdout) != (size_t)length;
    if (!failed) failed = fputc('\n', stdout) == EOF || fflush(stdout) != 0;
    Py_DECREF(text);
    if (failed && !PyErr_Occurred()) PyErr_SetString(PyExc_OSError, "Response write failed");
    return failed ? -1 : 0;
}

static PyObject *read_value(PyObject *decoder) {
    char *line = NULL;
    size_t allocated = 0;
    ssize_t length = getline(&line, &allocated, stdin);
    if (length < 0) { free(line); return NULL; }
    if (length > 1024 * 1024) {
        free(line); PyErr_SetString(PyExc_ValueError, "Input frame too large"); return NULL;
    }
    PyObject *text = PyUnicode_DecodeUTF8(line, length, "strict");
    free(line);
    if (!text) return NULL;
    PyObject *value = PyObject_CallOneArg(decoder, text);
    Py_DECREF(text);
    return value;
}

static PyObject *run(PyObject *self, PyObject *args) {
    PyObject *bootstrap, *dispatch, *diagnostic, *names;
    const char *filename;
    if (!PyArg_ParseTuple(args, "OOOsO", &bootstrap, &dispatch, &diagnostic, &filename, &names)) return NULL;
    if (!PyTuple_Check(names) || PyTuple_Size(names) != 2) {
        PyErr_SetString(PyExc_TypeError, "Two exception names required"); return NULL;
    }
    PyObject *json = NULL, *enc_module = NULL, *enc_instance = NULL, *dec_instance = NULL;
    PyObject *factory = NULL, *default_fn = NULL, *string_encoder = NULL, *markers = NULL;
    PyObject *colon = NULL, *comma = NULL, *encoder = NULL, *decoder = NULL;
    PyObject *initial = NULL, *module = NULL, *response = NULL;
    PyObject *classes[2] = {NULL, NULL};
    int failed = 1;
    json = PyImport_ImportModule("json");
    if (!json) goto done;
    enc_module = PyObject_GetAttrString(json, "encoder");
    enc_instance = PyObject_CallMethod(json, "JSONEncoder", NULL);
    dec_instance = PyObject_CallMethod(json, "JSONDecoder", NULL);
    if (!enc_module || !enc_instance || !dec_instance) goto done;
    factory = PyObject_GetAttrString(enc_module, "c_make_encoder");
    string_encoder = PyObject_GetAttrString(enc_module, "encode_basestring_ascii");
    default_fn = PyObject_GetAttrString(enc_instance, "default");
    decoder = PyObject_GetAttrString(dec_instance, "decode");
    markers = PyDict_New(); colon = PyUnicode_FromString(":"); comma = PyUnicode_FromString(",");
    if (!factory || !string_encoder || !default_fn || !decoder || !markers || !colon || !comma) goto done;
    encoder = PyObject_CallFunctionObjArgs(factory, markers, default_fn, string_encoder,
        Py_None, colon, comma, Py_False, Py_False, Py_True, NULL);
    if (!encoder) goto done;
    initial = read_value(decoder);
    if (!initial) goto done;
    module = PyObject_CallOneArg(bootstrap, initial);
    Py_CLEAR(initial);
    if (!module) {
        PyObject *type = NULL, *error = NULL, *tb = NULL;
        PyErr_Fetch(&type, &error, &tb);
        PyErr_NormalizeException(&type, &error, &tb);
        if (error && tb) PyException_SetTraceback(error, tb);
        PyObject *info = error ? PyObject_CallFunction(diagnostic, "Os", error, filename) : NULL;
        Py_XDECREF(type); Py_XDECREF(error); Py_XDECREF(tb);
        if (!info) goto done;
        response = Py_BuildValue("{s:O}", "initializationError", info);
        Py_DECREF(info);
        if (!response || send_value(encoder, response) < 0) goto done;
        failed = 0; goto done;
    }
    if (!PyModule_Check(module)) { PyErr_SetString(PyExc_TypeError, "Source module required"); goto done; }
    PyObject *namespace = PyModule_GetDict(module);
    for (int i = 0; i < 2; ++i) {
        PyObject *candidate = PyDict_GetItemWithError(namespace, PyTuple_GetItem(names, i));
        if (!candidate) { if (PyErr_Occurred()) goto done; continue; }
        if (!PyType_Check(candidate) || !PyType_IsSubtype((PyTypeObject *)candidate, (PyTypeObject *)PyExc_Exception)) {
            PyErr_SetString(PyExc_TypeError, "Custom exception classes required"); goto done;
        }
        PyObject *origin = PyDict_GetItemString(((PyTypeObject *)candidate)->tp_dict, "__module__");
        if (origin && PyUnicode_Check(origin) && PyUnicode_CompareWithASCIIString(origin, "builtins") == 0) {
            PyErr_SetString(PyExc_TypeError, "Builtin aliases are not custom exceptions"); goto done;
        }
        classes[i] = Py_NewRef(candidate);
    }
    response = Py_BuildValue("{s:O}", "ready", Py_True);
    if (!response || send_value(encoder, response) < 0) goto done;
    Py_CLEAR(response);
    for (;;) {
        PyObject *call = read_value(decoder);
        if (!call) { if (PyErr_Occurred()) goto done; break; }
        PyObject *id = PyDict_Check(call) ? PyDict_GetItemString(call, "callId") : NULL;
        if (!id || !PyUnicode_Check(id)) { Py_DECREF(call); PyErr_SetString(PyExc_ValueError, "Call id required"); goto done; }
        Py_INCREF(id);
        PyObject *value = PyObject_CallOneArg(dispatch, call);
        Py_DECREF(call);
        if (value) {
            response = Py_BuildValue("{s:O,s:O}", "callId", id, "value", value);
            Py_DECREF(value);
        } else {
            PyObject *type = NULL, *error = NULL, *tb = NULL;
            PyErr_Fetch(&type, &error, &tb);
            PyErr_NormalizeException(&type, &error, &tb);
            PyObject *kinds = PyList_New(0);
            if (!kinds) { Py_XDECREF(type); Py_XDECREF(error); Py_XDECREF(tb); Py_DECREF(id); goto done; }
            /* Read the actual native MRO, never metaclass hooks, builtins.type,
             * Python globals or a Python response serializer. */
            PyObject *mro = error ? Py_TYPE(error)->tp_mro : NULL;
            for (int i = 0; i < 2; ++i) if (classes[i] && mro && PyTuple_Check(mro)) {
                for (Py_ssize_t j = 0; j < PyTuple_Size(mro); ++j) {
                    if (PyTuple_GetItem(mro, j) == classes[i]) {
                        if (PyList_Append(kinds, PyTuple_GetItem(names, i)) < 0) {
                            Py_DECREF(kinds); Py_XDECREF(type); Py_XDECREF(error); Py_XDECREF(tb); Py_DECREF(id); goto done;
                        }
                        break;
                    }
                }
            }
            Py_XDECREF(type); Py_XDECREF(error); Py_XDECREF(tb);
            response = Py_BuildValue("{s:O,s:O,s:O}", "callId", id, "error", Py_True, "errorKinds", kinds);
            Py_DECREF(kinds);
        }
        Py_DECREF(id);
        if (!response || send_value(encoder, response) < 0) goto done;
        Py_CLEAR(response);
    }
    failed = 0;
done:
    Py_XDECREF(response); Py_XDECREF(module); Py_XDECREF(initial);
    Py_XDECREF(classes[0]); Py_XDECREF(classes[1]);
    Py_XDECREF(encoder); Py_XDECREF(decoder); Py_XDECREF(markers);
    Py_XDECREF(factory); Py_XDECREF(default_fn); Py_XDECREF(string_encoder);
    Py_XDECREF(colon); Py_XDECREF(comma); Py_XDECREF(enc_instance); Py_XDECREF(dec_instance);
    Py_XDECREF(enc_module); Py_XDECREF(json);
    if (failed) { if (!PyErr_Occurred()) PyErr_SetString(PyExc_RuntimeError, "Worker could not complete"); return NULL; }
    Py_RETURN_NONE;
}
static PyMethodDef methods[] = {{"run", run, METH_VARARGS, "Dispatch calls with native exception observation."}, {NULL, NULL, 0, NULL}};
static struct PyModuleDef definition = {PyModuleDef_HEAD_INIT, "_native_driver", NULL, -1, methods};
PyMODINIT_FUNC PyInit__native_driver(void) { return PyModule_Create(&definition); }
