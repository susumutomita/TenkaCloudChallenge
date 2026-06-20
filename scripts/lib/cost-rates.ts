/**
 * #87 Phase A — 静的 on-demand 料金表 + リソース分類。
 *
 * 見積もりエンジン (`scripts/estimate-cost.ts`) が参照する。値は概算 (USD/hour, 2025 の
 * on-demand 公開価格ベース)。目的は **厳密な請求額** ではなく「桁感」と「落とし忘れ課金
 * (= idle でも止まらないリソース) の可視化」。実額は account の free tier 状況・転送量・LCU
 * 等で変わるため、運用判断の一次情報として使う。
 */

export type Region = "ap-northeast-1" | "us-east-1";

export const DEFAULT_REGION: Region = "ap-northeast-1";

export const KNOWN_REGIONS: ReadonlySet<string> = new Set<Region>(["ap-northeast-1", "us-east-1"]);

/** EC2 instance 時間料金 (USD/hour, Linux on-demand)。region 別。 */
export const EC2_HOURLY: Record<Region, Record<string, number>> = {
  "ap-northeast-1": {
    "t2.micro": 0.0152,
    "t2.small": 0.0304,
    "t2.medium": 0.0608,
    "t3.micro": 0.0136,
    "t3.small": 0.0272,
    "t3.medium": 0.0544,
    "t3.large": 0.1088,
    "t3a.micro": 0.0122,
    "t3a.small": 0.0245,
    "m5.large": 0.124,
  },
  "us-east-1": {
    "t2.micro": 0.0116,
    "t2.small": 0.023,
    "t2.medium": 0.0464,
    "t3.micro": 0.0104,
    "t3.small": 0.0208,
    "t3.medium": 0.0416,
    "t3.large": 0.0832,
    "t3a.micro": 0.0094,
    "t3a.small": 0.0188,
    "m5.large": 0.096,
  },
};

/** RDS DB instance 時間料金 (USD/hour, single-AZ)。 */
export const RDS_HOURLY: Record<Region, Record<string, number>> = {
  "ap-northeast-1": { "db.t3.micro": 0.026, "db.t3.small": 0.052, "db.t4g.micro": 0.023 },
  "us-east-1": { "db.t3.micro": 0.018, "db.t3.small": 0.036, "db.t4g.micro": 0.016 },
};

/** instance class 非依存の固定時間料金リソース (USD/hour)。CFn resource Type を key にする。 */
export const FLAT_HOURLY: Record<Region, Record<string, number>> = {
  "ap-northeast-1": {
    "AWS::ElasticLoadBalancingV2::LoadBalancer": 0.0243,
    "AWS::EC2::NatGateway": 0.062,
    "AWS::EC2::EIP": 0.005,
    "AWS::Route53::HostedZone": 0.5 / 730,
  },
  "us-east-1": {
    "AWS::ElasticLoadBalancingV2::LoadBalancer": 0.0225,
    "AWS::EC2::NatGateway": 0.045,
    "AWS::EC2::EIP": 0.005,
    "AWS::Route53::HostedZone": 0.5 / 730,
  },
};

/**
 * stack が idle (instance 停止) でも課金が続くリソース型 (= 落とし忘れの主犯)。
 * delete-stack するまで止まらない。`alwaysOnResources` として metadata / report に出す。
 */
export const ALWAYS_ON_TYPES: ReadonlySet<string> = new Set([
  "AWS::RDS::DBInstance",
  "AWS::ElasticLoadBalancingV2::LoadBalancer",
  "AWS::EC2::NatGateway",
  "AWS::EC2::EIP",
  "AWS::Route53::HostedZone",
]);

/** 新規 account の free tier (750h/月 等) で実質無料の instance type。 */
export const FREE_TIER_INSTANCE_TYPES: ReadonlySet<string> = new Set([
  "t2.micro",
  "t3.micro",
  "t3a.micro",
  "t4g.micro",
]);

/** EC2 instance に InstanceType を解決できなかったときの保守的な既定値。 */
export const FALLBACK_INSTANCE_TYPE = "t3.micro";

/** 小数を d 桁で丸める (浮動小数の末尾ノイズを断つ = `--check` を決定的にする)。 */
export function round(n: number, d: number): number {
  const f = 10 ** d;
  return Math.round(n * f) / f;
}
