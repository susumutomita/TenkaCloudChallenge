import {expect, test} from "bun:test";
import {power, verifySchnorr, simulateSchnorr} from "./schnorr.ts";
test("lecture transcript verifies without the private witness", () => {
  expect(verifySchnorr(13, 8, 5, 5)).toBe(true);
  expect(verifySchnorr(13, 8, 5, 6)).toBe(false);
  for (const invalid of [-1, 11, 1.5, NaN, Infinity]) expect(verifySchnorr(13,8,5,invalid)).toBe(false);
  expect(verifySchnorr(5,8,5,5)).toBe(false);
});
test("all real and simulated transcripts have exactly the same distribution", () => {
  for(let x=0;x<11;x++) {
    const y=power(2,x), real:string[]=[], simulated:string[]=[];
    for(let e=0;e<11;e++) for(let r=0;r<11;r++) {
      const a=power(2,r), z=(r+e*x)%11;
      expect(verifySchnorr(y,a,e,z)).toBe(true);
      real.push(`${a}:${e}:${z}`);
      simulated.push(`${simulateSchnorr(y,e,r)}:${e}:${r}`);
    }
    expect(real.sort()).toEqual(simulated.sort());
  }
});
test("two challenges for the same commitment extract the witness",()=>{
  for(let x=0;x<11;x++) for(let r=0;r<11;r++) {
    const z1=(r+2*x)%11,z2=(r+3*x)%11;
    expect((z2-z1+11)%11).toBe(x);
  }
});
