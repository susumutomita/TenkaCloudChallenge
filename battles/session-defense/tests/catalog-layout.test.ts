import {test,expect} from "bun:test";
import {existsSync,readdirSync,readFileSync} from "node:fs";
import {join} from "node:path";
test("registered directory has metadata and a narrow native coordination contract",()=>{
  const root=new URL("../../../",import.meta.url).pathname;
  for(const group of ["challenges","battles"])for(const e of readdirSync(join(root,group),{withFileTypes:true})){
    if(e.isDirectory()&&/^[a-z0-9][a-z0-9-]*$/.test(e.name))expect(existsSync(join(root,group,e.name,"metadata.json"))).toBe(true);
  }
  const dir=join(root,"battles/session-defense");
  const meta=JSON.parse(readFileSync(join(dir,"metadata.json"),"utf8"));
  expect(meta.id).toBe("session-defense");expect(meta.category).toBe("Battle");
  expect(meta.runtime).toEqual({provider:"local",engine:"bun",entry:"coordination/session-defense.ts"});
  expect(meta.interTeamCoordination.plugin).toBe(meta.runtime.entry);
  expect(meta.dashboard.slots.StatusPanel).toBe("portal/StatusPanel.tsx");
  expect(meta.exposedPorts).toEqual([]);
  for(const field of ["cfnTemplate","cfnParameters","scoring","endpoints"])expect(meta[field]).toBeUndefined();
  for(const file of [meta.runtime.entry,meta.dashboard.slots.StatusPanel,"README.md","README.ja.md"])expect(existsSync(join(dir,file))).toBe(true);
  expect(meta.i18n.en.instructions).toContain("Both teams press Ready");
  expect(existsSync(join(root,"battles/_session-defense"))).toBe(false);
});
