import {test,expect} from "bun:test";
import {existsSync,readdirSync} from "node:fs";
import {join} from "node:path";
test("unregistered prototype stays outside the host's eligible-directory scan",()=>{
  const root=new URL("../../../",import.meta.url).pathname;
  for(const group of ["challenges","battles"])for(const e of readdirSync(join(root,group),{withFileTypes:true})){
    if(e.isDirectory()&&/^[a-z0-9][a-z0-9-]*$/.test(e.name))expect(existsSync(join(root,group,e.name,"metadata.json"))).toBe(true);
  }
  expect(/^[a-z0-9][a-z0-9-]*$/.test("_session-defense")).toBe(false);
  expect(existsSync(join(root,"battles/session-defense"))).toBe(false);
});
