import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import Ajv from "ajv";
import addFormats from "ajv-formats";
import { checkNativeCoordinationRefs } from "./validate-problems";
const root=new URL("..",import.meta.url).pathname,dir=join(root,"battles/pi-siege");
const metadata=JSON.parse(readFileSync(join(dir,"metadata.json"),"utf8"));
const ajv=new Ajv({strict:false,allErrors:true});addFormats(ajv);
const schema=ajv.compile(JSON.parse(readFileSync(join(root,"SCHEMA.json"),"utf8")));

test("native coordination needs no fake AWS template, port or Docker verifier",()=>{
  expect(schema(metadata)).toBe(true);
  expect(checkNativeCoordinationRefs(dir,metadata).errors).toEqual([]);
  expect(metadata.runtime.entry).toBe(metadata.interTeamCoordination.plugin);
});
test("schema retains the legacy port requirement and rejects unrelated local engines",()=>{
  const old=JSON.parse(readFileSync(join(root,"battles/hello-world-battle/metadata.json"),"utf8"));
  expect(schema(old)).toBe(true);
  expect(schema({...old,exposedPorts:[]})).toBe(false);
  expect(schema({...metadata,runtime:{...metadata.runtime,engine:"compose"}})).toBe(false);
  expect(schema({...metadata,category:"Challenge"})).toBe(false);
  expect(schema({...metadata,exposedPorts:[{port:1,name:"fake"}]})).toBe(false);
});
test("native cross-references fail for missing authority, slot, foreign scoring and entry mismatch",()=>{
  for (const patch of [
    {runtime:{...metadata.runtime,entry:"coordination/missing.ts"}},
    {interTeamCoordination:{plugin:"coordination/missing.ts"}},
    {dashboard:{slots:{}}}, {scoring:{kind:"verify"}}, {cfnTemplate:"template.yaml"},
    {runtime:{...metadata.runtime,verifyUrl:"http://127.0.0.1/verify"}},
  ]) expect(checkNativeCoordinationRefs(dir,{...metadata,...patch}).errors.length).toBeGreaterThan(0);
});
