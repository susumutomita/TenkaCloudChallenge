/** Section 5.1 rejection-sampling teaching model. Tiny ElGamal arithmetic
 * and a six-entry balanced secret lookup replace IND-CPA security and a PRF.
 * This finite, one-message model is not secure reusable anamorphic encryption. */
export type AnamorphicCipher = readonly [number,number];
const mod=(n:number)=>((n%7)+7)%7;
export function anamorphicPower(base:number,exponent:number):number{
 let result=1;for(let i=0;i<exponent;i++)result=mod(result*base);return result;
}
export function anamorphicEncrypt(message:number,key:number,randomness:number):AnamorphicCipher{
 return [anamorphicPower(3,randomness),mod(message*anamorphicPower(anamorphicPower(3,key),randomness))];
}
export function anamorphicDecrypt(cipher:AnamorphicCipher,key:number):number{
 const mask=anamorphicPower(cipher[0],key);
 const inverse=[1,2,3,4,5,6].find(n=>n*mask%7===1);
 if(inverse===undefined)throw new Error('invalid multiplicative ciphertext');
 return mod(cipher[1]*inverse);
}
export const ANAMORPHIC_LOOKUPS:readonly (readonly number[])[]=Array.from({length:64},(_,n)=>Array.from({length:6},(_,i)=>(n>>i)&1)).filter(row=>row.reduce((a,b)=>a+b,0)===3);
export interface AnamorphicTask{
 readonly kind:'anamorphic-rejection';
 readonly ordinaryKey:number;
 readonly candidates:readonly AnamorphicCipher[];
 /** The participant acts as sender/receiver; this additional table is NOT in the monitor's view. */
 readonly secretBits:readonly number[];
 readonly targetBit:number;
 readonly receivedIndex:number;
}
export function anamorphicAnswer(task:AnamorphicTask):readonly number[]{
 const selected=task.secretBits.indexOf(task.targetBit);
 if(selected<0)throw new Error('no matching candidate');
 return [selected+1,anamorphicDecrypt(task.candidates[selected]!,task.ordinaryKey),task.secretBits[task.receivedIndex]!];
}
export function anamorphicTask(bytes:readonly number[]):AnamorphicTask{
 if(bytes.length<10)throw new Error('ten bytes required');
 const ordinaryKey=1+bytes[0]!%5,message=1+bytes[1]!%6;
 const trials=[0,1,2,3,4,5];
 for(let i=5;i>0;i--){const j=bytes[10-i]!%(i+1);[trials[i],trials[j]]=[trials[j]!,trials[i]!];}
 const lookup=ANAMORPHIC_LOOKUPS[bytes[2]!%20]!;
 return {kind:'anamorphic-rejection',ordinaryKey,candidates:trials.map(r=>anamorphicEncrypt(message,ordinaryKey,r)),secretBits:trials.map(r=>lookup[r]!),targetBit:bytes[3]!%2,receivedIndex:bytes[4]!%6};
}
export function parseAnamorphicAnswer(answer:unknown):readonly number[]|undefined{
 return typeof answer==='string'&&/^[1-6] [1-6] [01]$/.test(answer)?answer.split(' ').map(Number):undefined;
}
