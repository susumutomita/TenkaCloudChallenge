import {expect,test} from 'bun:test';
import {advancedHints} from './advanced-hints.ts';
import type {HintContext} from './hints.ts';
import {initialState,projectForTeam} from './reducer.ts';
import type {OrderTaskProjection} from './types.ts';
const projection=projectForTeam(initialState({eventId:'hint-reader',teamIds:['a','b'],matchSecret:'c'.repeat(64)}),'a');
function context(task:OrderTaskProjection):HintContext{return {task,vault:projection.vault,prime:projection.prime,threshold:projection.threshold,shareCount:projection.vault.shares.length,allowedMethods:[],exposedShareIndices:[]};}
const text=(task:OrderTaskProjection)=>advancedHints(context(task),2)!;
test('EC inverse, tangent, identity and cancellation instructions match branches',()=>{
 const ordinary=text({kind:'ec-add',left:[2,1],right:[3,1]});
 expect(ordinary.ja).toContain('分母D=3−2');expect(ordinary.en).toContain('Number row');
 const doubled=text({kind:'ec-add',left:[2,1],right:[2,1]});expect(doubled.ja).toContain('分母D=2×1');expect(doubled.ja).toContain('3×2×2+2');
 expect(text({kind:'ec-add',left:null,right:null}).ja).toContain('英大文字のO');
 expect(text({kind:'ec-add',left:[2,1],right:[2,6]}).ja).toContain('打ち消し合う');
});
test('ECDSA separates table coordinate and scalar steps without supplying s',()=>{
 const hint=text({kind:'ecdsa-sign',hash:1,d:2,k:2});expect(hint.ja).toContain('jG=(1,3)');expect(hint.ja).toContain('2×r=□A');expect(hint.ja).toContain('1+A=□B');expect(hint.ja).toContain('I×B=□C');expect(hint.ja).not.toContain('s=5');
});
test('STARK maps supplied quotient and trace computations to four fields',()=>{
 const hint=text({kind:'stark-trace',trace:[2,5,3],beta:2});expect(hint.ja).toContain('2×2=□A');expect(hint.ja).toContain('5×5=□B');expect(hint.ja).toContain('Rの定数');expect(hint.ja).toContain('表示済みのQ');expect(hint.en).toContain('field 2 (v)');
});
test('split anamorphic hints require only the chosen operation and leave calculation to the player',()=>{
 const base={kind:'anamorphic-rejection' as const,ordinaryKey:2,candidates:[[2,5],[1,3],[3,6],[4,6],[5,5],[6,3]] as const,secretBits:[0,1,1,0,1,0],targetBit:1,tickets:[1,1,2,1,1,1]};
 const encrypt=text({...base,exercise:'encrypt'});expect(encrypt.ja).not.toContain('S×');expect(encrypt.ja).not.toContain('候補番号2');
 const decrypt=text({...base,exercise:'decrypt'});expect(decrypt.ja).toContain('左a=2、右b=5');expect(decrypt.ja).not.toContain('くじ');expect(decrypt.ja).not.toContain('m = 3');
 const probability=text({...base,exercise:'probability'});expect(probability.ja).toContain('1 + 2 + 1 = □');expect(probability.ja).not.toContain('S×');
});

test('paid advanced hint destinations exist in the actual worksheets',async()=>{
 const {createElement}=await import('react');const {renderToStaticMarkup}=await import('react-dom/server');
 const {default:EvolutionWorksheet}=await import('../../portal/EvolutionWorksheet.tsx');
 const {StarkWorksheet}=await import('../../portal/StarkWorksheet.tsx');
 const {SnarkWorksheet}=await import('../../portal/SnarkWorksheet.tsx');
 const {IoWorksheet}=await import('../../portal/IoWorksheet.tsx');
 const common={locale:'ja' as const,busy:false,wrongCost:6,onSubmit:()=>{}};
 const rsa={kind:'rsa-decrypt' as const,ciphertext:8,n:15,d:3};const rsaHtml=renderToStaticMarkup(createElement(EvolutionWorksheet,{...common,task:rsa}));
 for(const label of ['答えの数字1個','計算した答えを提出']){expect(rsaHtml).toContain(label);expect(text(rsa).ja).toContain(label);}
 const stark={kind:'stark-trace' as const,trace:[2,5,3] as const,beta:2};const starkHtml=renderToStaticMarkup(createElement(StarkWorksheet,{...common,task:stark}));
 for(const label of ['Rの定数','4個の計算を提出']){expect(starkHtml).toContain(label);expect(text(stark).ja).toContain(label);}
 const snark={kind:'snark-constraints' as const,rows:[[1,2,3],[2,3,6],[3,6,2]] as const};const snarkHtml=renderToStaticMarkup(createElement(SnarkWorksheet,{...common,task:snark}));
 for(const label of ['行1','配線1','検査結果を提出']){expect(snarkHtml).toContain(label);expect(text(snark).ja).toContain(label);}
 const io={kind:'io-equivalence' as const,a:2,b:1,c:0,d:1,missing:[1,2] as const};const ioHtml=renderToStaticMarkup(createElement(IoWorksheet,{...common,task:io}));
 for(const label of ['4行すべて同じ答え？','共通する組の個数（0〜4）','計算と比較を提出']){expect(ioHtml).toContain(label);expect(text(io).ja).toContain(label);}
});

test('RSA second rung provides the transferable formula before its worked example',()=>{
 const hints=advancedHints(context({kind:'rsa-decrypt',ciphertext:8,n:15,d:3}),1)!;
 for(const locale of ['ja','en'] as const){
  expect(hints[locale]).toContain('m = c^d mod n');
  expect(hints[locale].indexOf('m = c^d mod n')).toBeLessThan(hints[locale].indexOf('8×8=64'));
 }
});

test('formula rung explains rotor advancement and EC doubling before own-value steps',()=>{
 const enigma=advancedHints(context({kind:'enigma-encrypt',initial:3,plaintext:[0]}),1)!;
 expect(enigma.ja).toContain('(初期位置+1)');
 expect(enigma.en).toContain('(initial+1)');
 expect(enigma.ja).toContain('初期位置3なら今回の位置0');
 const ec=advancedHints(context({kind:'ec-add',left:[2,1],right:[2,1]}),1)!;
 for(const locale of ['ja','en'] as const){
  expect(ec[locale]).toContain('(3×x1²+2)');
  expect(ec[locale]).toContain('3×2×2+2=14');
  expect(ec[locale]).toContain('3 6');
 }
});
