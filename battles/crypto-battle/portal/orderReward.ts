import type {ContractProjection,CryptoBattleProjection} from "../game/src/types.ts";
/** A receipt is one Order's award, not net score movement across a stale poll. */
export function orderReward(order:Pick<ContractProjection,"id"|"points">,next:Pick<CryptoBattleProjection,"lightning">):number {
 const card=next.lightning;
 if(card?.status==="spent"&&card.outcome==="hit"&&card.contractId===order.id){
  if(typeof card.points!=="number")throw new Error("completed Lightning award has no points");
  return card.points;
 }
 return order.points;
}
