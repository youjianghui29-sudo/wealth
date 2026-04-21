export type FundAssetMode = "open" | "money" | "exchange" | "qdii" | "fof" | "reits" | "unknown";

export type FundClassificationInput = {
  code?: string | null;
  name?: string | null;
  fundType?: string | null;
  fundTypeDetail?: string | null;
  benchmark?: string | null;
};

export type FundClassification = {
  displayType: string;
  normalizedType: string;
  assetMode: FundAssetMode;
  source: "source" | "profile" | "name" | "code" | "unknown";
  notes: string[];
};

function clean(value: string | null | undefined) {
  const text = String(value ?? "").trim();
  if (!text || text === "--" || text.toLowerCase() === "null") {
    return "";
  }
  return text;
}

function isUnknownType(value: string) {
  return !value || value === "??" || value === "未知" || value.toLowerCase() === "unknown";
}

function normalizeKnownType(value: string) {
  if (/ETF/i.test(value)) return "ETF";
  if (/LOF/i.test(value)) return "LOF";
  if (/QDII/i.test(value)) return "QDII";
  if (/FOF/i.test(value)) return "FOF";
  if (/REIT/i.test(value)) return "REITs";
  if (/货币|现金|理财/.test(value)) return "货币型";
  if (/债券|债基|纯债|转债|短债|中短债/.test(value)) return "债券型";
  if (/指数|联接|增强|ETF联接/.test(value)) return "指数型";
  if (/股票/.test(value)) return "股票型";
  if (/混合|灵活配置|偏股|偏债|平衡/.test(value)) return "混合型";
  if (/商品|黄金|白银|原油|有色/.test(value)) return "商品型";
  return value;
}

function exchangeTypeByCode(code: string) {
  if (/^(15|16|18|50|51|52|56|58)\d{4}$/.test(code)) {
    return true;
  }
  return false;
}

export function classifyFund(input: FundClassificationInput): FundClassification {
  const code = clean(input.code);
  const name = clean(input.name);
  const sourceType = normalizeKnownType(clean(input.fundType));
  const profileType = normalizeKnownType(clean(input.fundTypeDetail));
  const benchmark = clean(input.benchmark);
  const combined = `${name} ${profileType} ${benchmark}`;
  const notes: string[] = [];

  if (!isUnknownType(sourceType)) {
    const normalizedType = normalizeKnownType(sourceType);
    return {
      displayType: normalizedType,
      normalizedType,
      assetMode: modeForType(normalizedType, code, combined),
      source: "source",
      notes
    };
  }

  if (!isUnknownType(profileType)) {
    const normalizedType = normalizeKnownType(profileType);
    return {
      displayType: normalizedType,
      normalizedType,
      assetMode: modeForType(normalizedType, code, combined),
      source: "profile",
      notes: ["类型来自基金资料，Fund.fundType 仍需回填"]
    };
  }

  let inferred = "未知";
  if (/ETF/i.test(combined)) inferred = "ETF";
  else if (/LOF/i.test(combined)) inferred = "LOF";
  else if (/QDII|全球|海外|美国|纳斯达克|标普|恒生|港股|越南|印度|德国|日经/.test(combined)) inferred = "QDII";
  else if (/FOF|养老目标|目标日期|目标风险/.test(combined)) inferred = "FOF";
  else if (/REIT/i.test(combined) || /基础设施/.test(combined)) inferred = "REITs";
  else if (/货币|现金|天天|余额|活期|添利宝|保证金/.test(combined)) inferred = "货币型";
  else if (/债券|纯债|短债|中短债|转债|信用债|利率债|添利|稳利|鑫利/.test(combined)) inferred = "债券型";
  else if (/指数|联接|增强|沪深|中证|创业板|科创|红利|宽基|行业主题/.test(combined)) inferred = "指数型";
  else if (/股票|量化|行业|科技|消费|医药|新能源|半导体|军工|白酒/.test(combined)) inferred = "股票型";
  else if (/混合|灵活|优选|精选|成长|价值|均衡|优势|创新|回报|策略|主题/.test(combined)) inferred = "混合型";
  else if (/黄金|白银|原油|商品|有色|豆粕/.test(combined)) inferred = "商品型";
  else if (exchangeTypeByCode(code)) inferred = "场内基金";

  if (inferred !== "未知") {
    notes.push("类型由名称/代码推断，建议后续写回 Fund.fundType");
  }

  return {
    displayType: inferred,
    normalizedType: inferred,
    assetMode: modeForType(inferred, code, combined),
    source: inferred === "场内基金" ? "code" : inferred === "未知" ? "unknown" : "name",
    notes
  };
}

export function modeForType(type: string, code?: string | null, text = ""): FundAssetMode {
  if (/货币/.test(type) || /货币|现金|余额|天天/.test(text)) return "money";
  if (/ETF|LOF|场内/.test(type) || exchangeTypeByCode(clean(code))) return "exchange";
  if (/QDII/.test(type)) return "qdii";
  if (/FOF/.test(type)) return "fof";
  if (/REIT/i.test(type)) return "reits";
  if (type === "未知") return "unknown";
  return "open";
}

export function fundTypeFilterSqlHint(type: string) {
  return normalizeKnownType(type.trim());
}
