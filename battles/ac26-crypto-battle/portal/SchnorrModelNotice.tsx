/** The hand-calculation model must not claim practical proof-of-knowledge security. */
export function SchnorrModelNotice({locale}:{locale:"ja"|"en"}) {
  const ja=locale==="ja";
  return <aside aria-label={ja?"この模型の採点と限界":"Model scoring and limits"} className="tc-card-hint">
    <strong>{ja?"得点になるのは、検証式に合う応答の計算です。":"Points reward a response that satisfies the verification equation."}</strong>
    <p>{ja?"秘密の候補は11通りしかないため、この模型の合格だけでは、秘密を知っていたことや安全な本人確認を保証できません。":"With only 11 possible secret values, acceptance in this model cannot establish prior knowledge of the secret or provide secure authentication."}</p>
    <p>{ja?"扱うのは公開値yに対応する数xです。シェアの値や数独の解を知っているかは検査しません。":"The calculation concerns the number x corresponding to public y. It does not check knowledge of a share value or a Sudoku solution."}</p>
  </aside>;
}
