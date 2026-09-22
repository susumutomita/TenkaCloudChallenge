export const COPY = {
  ja: {
    title: "隣のチームと、つながろう", intro: "別チームの人と話して、合言葉を交換。お互いの確認がそろうと、それぞれ +20 点！",
    start: "自分の合言葉を受け取る", yourCode: "渡す合言葉", how: "① 相手と合言葉を交換 → ② 相手のチームを押す → ③ もらった合言葉を送る。相手にも同じ操作をしてもらいましょう。",
    bonus: "交流ボーナス", cap: "別々の3組まで。上限に達しても、初めての相手のお手伝いはできます。", complete: "交換できた！", waiting: "あなたの確認を待っています", choose: "このチームと交換", noPeer: "別チームが参加すると交換できます。自分の復旧を進めましょう。",
    partnerCode: "相手からもらった合言葉", send: "合言葉を確認して交換する", pending: "相手の確認待ちです。減点はありません。別の相手に変更もできます。", cancel: "確認待ちを取り消す", refresh: "状況を更新",
    errors: { unavailable: "読み込めませんでした。「状況を更新」で再試行してください。", check_partner_code: "相手の合言葉か、選んだチームを確かめてください。", already_exchanged: "この相手とは交換済みです。別の相手を選んでください。", bonus_limit: "両チームとも3組達成しています。まだ達成していないチームと交換できます。", choose_another_team: "別のチームを選んでください。", not_ready: "先に自分の合言葉を受け取ってください。" },
  },
  en: {
    title: "Connect with another team", intro: "Talk to another team and exchange codes. When both teams confirm, each earns +20 points!",
    start: "Get my exchange code", yourCode: "Code to share", how: "1. Exchange codes in person. 2. Choose their team below. 3. Submit the code they gave you. Ask them to do the same.",
    bonus: "Cooperation bonus", cap: "Up to three different partners. After reaching the cap, you can still help a new partner.", complete: "Connected!", waiting: "Waiting for your confirmation", choose: "Connect with this team", noPeer: "Exchange opens when another team joins. Continue your recovery in the meantime.",
    partnerCode: "Code received from this team", send: "Confirm our exchange", pending: "Waiting for your partner. No penalty. You may choose another team.", cancel: "Cancel waiting", refresh: "Refresh situation",
    errors: { unavailable: "Could not load. Use Refresh situation to retry.", check_partner_code: "Check the partner code and selected team.", already_exchanged: "Already exchanged with this team. Choose another.", bonus_limit: "Both teams have three partners. Help a team that has not reached the cap.", choose_another_team: "Choose another team.", not_ready: "Get your own code first." },
  },
} as const;
