export type FundListItem = {
  code: string;
  name: string;
  fundType: string | null;
  fundTypeSource?: string | null;
  assetMode?: string | null;
  purchaseStatus: string | null;
  redeemStatus: string | null;
  tradeDate: Date | string | null;
  unitNav: number | null;
  accumulatedNav: number | null;
  dailyGrowthValue: number | null;
  dailyGrowthRate: number | null;
  growthRateSource: string | null;
  selectedReturnRange: string | null;
  selectedReturnDate: Date | string | null;
  selectedReturn: number | null;
  maxDrawdown: number | null;
  volatility: number | null;
  dataCompleteness: number | null;
  dataQualityLabel?: string | null;
  missingActions?: string[];
  navSampleCount: number | null;
  hasProfile: number | boolean | null;
  hasFee: number | boolean | null;
  watched: number | boolean;
};

export type WealthListItem = {
  registerCode: string;
  name: string;
  issuer: string | null;
  riskLevel: string | null;
  operationMode: string | null;
  productType: string | null;
  saleStatus: string | null;
  latestDisclosureAt: Date | string | null;
  sourceUrl: string | null;
  navDate: Date | string | null;
  netValue: number | null;
  accumulatedValue: number | null;
  dailyChange: number | null;
  dailyChangeRate: number | null;
  navStatus: string | null;
  watched: number | boolean;
};

export type PagedResult<T> = {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
};

export type NavPoint = {
  date: string;
  value: number | null;
  changeRate: number | null;
};

export type FundRankingItem = {
  fundCode: string;
  name: string;
  fundType: string | null;
  rankDate: Date | string;
  rangeKey: string;
  rankValue: number | null;
  unitNav: number | null;
  dailyGrowthRate: number | null;
};

export type FundCandidateItem = {
  code: string;
  name: string;
  fundType: string | null;
  assetMode: string | null;
  tradeDate: Date | string | null;
  unitNav: number | null;
  dailyGrowthRate: number | null;
  weekReturn: number | null;
  month3Return: number | null;
  month6Return: number | null;
  year1Return: number | null;
  peerPercentile: number | null;
  maxDrawdown: number | null;
  volatility: number | null;
  dataScore: number;
  observationScore: number;
  observationTier?: "strong" | "watchable" | "cautious";
  navSampleCount: number;
  hasProfile: boolean;
  hasFee: boolean;
  highImpactAnnouncementCount: number;
  purchaseStatus: string | null;
  watched: boolean;
  reasons: string[];
  risks: string[];
};

export type FundCandidateSummary = {
  totalScanned: number;
  strongCount: number;
  watchableCount: number;
  cautiousCount: number;
  generatedAt: string;
};

export type MoneyFundItem = {
  fundCode: string;
  fundName: string;
  tradeDate: Date | string;
  tenThousandIncome: number | null;
  sevenDayAnnualized: number | null;
  dailyGrowthRate: number | null;
  managerNames: string | null;
  purchaseStatus: string | null;
};

export type ExchangeFundItem = {
  fundCode: string;
  fundName: string;
  exchangeType: string;
  tradeDate: Date | string;
  latestPrice: number | null;
  changeValue: number | null;
  changeRate: number | null;
  discountRate: number | null;
  amount: number | null;
  totalMarketValue: number | null;
};
