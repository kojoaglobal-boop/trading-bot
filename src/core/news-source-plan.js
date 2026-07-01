import { defaultConfig } from "../config/default.js";

export function getNewsSourcePlan(config = defaultConfig) {
  const news = config.news || {};
  return {
    stock: normalizeSectionPlan(news.stock || {
      required: ["finnhub-company-news"],
      optional: ["finnhub-market-news"],
      purpose: "Company headlines, sector catalysts, and broad market risk."
    }),
    gold: normalizeSectionPlan(news.gold || {
      required: ["finnhub-market-news"],
      optional: ["fred-macro"],
      purpose: "Macro risk, USD/rates pressure, geopolitics, and metals sentiment."
    }),
    oil: normalizeSectionPlan(news.oil || {
      required: ["eia-petroleum", "finnhub-market-news"],
      optional: ["fred-macro"],
      purpose: "Inventory shocks, energy headlines, USD/rates pressure, and crude momentum catalysts."
    }),
    meme: normalizeSectionPlan(news.meme || {
      required: [],
      optional: ["finnhub-market-news", "coinbase", "kraken"],
      purpose: "Crypto market sentiment, exchange data, and later social/on-chain signals."
    })
  };
}

export function formatNewsSourcePlan(plan = getNewsSourcePlan()) {
  const lines = [];
  lines.push("News/Catalyst Source Plan");
  lines.push("=========================");

  for (const [section, item] of Object.entries(plan)) {
    lines.push("");
    lines.push(`${section.toUpperCase()}`);
    lines.push(`  required: ${item.required.length ? item.required.join(", ") : "none"}`);
    lines.push(`  optional: ${item.optional.length ? item.optional.join(", ") : "none"}`);
    lines.push(`  purpose:  ${item.purpose}`);
  }

  return lines.join("\n");
}

function normalizeSectionPlan(plan) {
  return {
    required: Array.isArray(plan.required) ? plan.required : [],
    optional: Array.isArray(plan.optional) ? plan.optional : [],
    purpose: String(plan.purpose || "")
  };
}
