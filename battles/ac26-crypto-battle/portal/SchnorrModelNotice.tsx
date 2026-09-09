export function SchnorrModelNotice({locale}:{locale:"ja"|"en"}) {
  const ja=locale==="ja";
  return <aside className="tc-card-hint" aria-label={ja?"この模型の採点と限界":"Model scoring and limits"}>
    <strong>{ja?"このお題は、式に合う答えを計算すると得点できます。":"In this exercise, calculate an answer that matches the equation to earn points."}</strong>
    <p>{ja?"秘密の数の候補は最大11通りです。少ない候補から答えを探せるため、式が合うだけでは、もともと秘密を知っていたと確かめられません。":"There are at most 11 possible secret values. With so few candidates to try, a matching answer cannot establish that you already knew the secret."}</p>
    <p>{ja?"ここで使うxは計算用の秘密の数です。シェア（秘密を分けて持つ番号と数の組）の値や、数独の解を知っているかは検査しません。":"Here x is the secret number used for the calculation. This does not check a share (a numbered value used to split a secret) or a Sudoku solution."}</p>
  </aside>;
}
