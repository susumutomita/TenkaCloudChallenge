import type {ContractProjection,CryptoBattleProjection} from "../game/src/types.ts";
/** A receipt is one Order's award, not net score movement across a stale poll. */
export function orderReward(order:Pick<ContractProjection,"id"|"points">,next:Pick<CryptoBattleProjection,"lightning">):number {
 const card=next.lightning;
 return card?.status==="spent"&&card.outcome==="hit"&&card.contractId===order.id?card.points:order.points;
}
