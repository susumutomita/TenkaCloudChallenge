import { useState } from "react";
import type { CryptoBattleProjection } from "../game/src/types.ts";
const methods={share:"秘密分散の秘密",sudoku:"数独の解",caesar:"シーザー暗号の鍵",vigenere:"Vigenère暗号の鍵",rsa:"RSAの素因数",rotor:"Rotorの初期位置"};
export function BreachNotice({projection,locale,onDefend}:{projection:CryptoBattleProjection;locale:"ja"|"en";onDefend:()=>void}) {
  const [dismissed,setDismissed]=useState(false);
  const notice=projection.lastBreach;
  if(!notice)return null;
  const current=notice.generation===projection.vault.generation;
  const attacker=projection.teams[notice.attackerTeamId]?.teamName || notice.attackerTeamId;
  const ja=locale==="ja";
  const floating=current&&!dismissed;
  return <aside role={floating?"alert":"status"} aria-atomic="true" style={{...(floating?{position:"fixed" as const,bottom:16,right:16,width:"min(420px, calc(100vw - 32px))",boxSizing:"border-box" as const,zIndex:100,boxShadow:"0 6px 28px #0003"}:{}),border:`3px solid ${current?"#b42318":"#476582"}`,borderRadius:12,padding:20,margin:"16px 0",background:current?"#fff1ed":"#f1f6fa",color:"#252b36"}}>
    <h2 style={{margin:"0 0 8px"}}>{current?(ja?"⚠ 秘密を見破られました":"⚠ Your secret was recovered"):(ja?"以前の秘密が見破られた記録":"Previous secret recovery")}</h2>
    <p><strong>{attacker}</strong> · {ja?methods[notice.method]:notice.method} · {ja?"世代":"Generation"} {notice.generation}</p>
    <p style={{fontSize:24,fontWeight:800}}>{notice.points===0?(ja?"得点の減少は0点（0点より下にはなりません）":"0 points lost (score cannot fall below zero)"):`${notice.points} ${ja?"点":"points"}`}</p>
    {current?<><p>{ja?"防御の操作前に、未回答のお題への影響を確認できます。":"Review the effect on unanswered Orders before replacing secrets."}</p><button type="button" onClick={()=>{setDismissed(true);onDefend();}}>{ja?"防御を確認：秘密を作り直す":"Review defense: replace secrets"}</button>{floating&&<button type="button" onClick={()=>setDismissed(true)} style={{marginLeft:8}}>{ja?"確認した":"Dismiss"}</button>}</>:<p>{ja?"現在は新しい世代へ切り替わっています。":"You have switched to a new generation."}</p>}
  </aside>;
}
