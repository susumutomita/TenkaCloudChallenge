import MathText from "./MathText.tsx";

/** Each authored step remains a separate visible block in either locale. */
export default function HintContent({text}:{readonly text:string}) {
  return <div className="tc-hint-content">{text.split(/\n+/).filter(line=>line.trim()).map((line,i)=><p key={i} className="tc-hint-text" style={{fontSize:14,margin:"8px 0",lineHeight:1.8}}><MathText>{line}</MathText></p>)}</div>;
}
