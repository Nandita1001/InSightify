/**
 * dataDictionary.js — Metric & Column Definitions
 *
 * Used by:
 *   - queryEngine.getMetricDefinitions()  → enriches narrative prompts
 *   - queryEngine.getDataDictionary()     → exposed to UI & uploaded dataset merging
 *
 * Add entries here for any column or KPI that needs a plain-English description.
 * Name matching is case-insensitive in getMetricDefinitions().
 */

export const DATA_DICTIONARY = [
  /* ── Financial ── */
  { name: "Revenue",           def: "Total income generated from sales before expenses are deducted" },
  { name: "Cost",              def: "Total operational, production, and fixed costs incurred" },
  { name: "Margin",            def: "Net profit margin — revenue minus costs, expressed as a percentage of revenue" },
  { name: "Profit",            def: "Revenue minus total costs; net earnings after all expenses" },
  { name: "Ad_Spend",          def: "Total advertising expenditure for the period (USD)" },
  { name: "Q1",                def: "Quarterly spend or revenue for Q1 (January–March)" },
  { name: "Q2",                def: "Quarterly spend or revenue for Q2 (April–June)" },
  { name: "Q3",                def: "Quarterly spend or revenue for Q3 (July–September)" },
  { name: "Q4",                def: "Quarterly spend or revenue for Q4 (October–December)" },

  /* ── Sales ── */
  { name: "Units",             def: "Number of units sold during the period" },
  { name: "Returns",           def: "Number of products returned by customers" },
  { name: "Product",           def: "Item or service sold (e.g., Widget A, Widget B)" },
  { name: "Channel",           def: "Sales channel through which the transaction occurred (Online, Retail, Wholesale)" },
  { name: "Region",            def: "Geographical sales territory (North, South, East, West)" },
  { name: "Month",             def: "Calendar month of the sales or engagement period" },

  /* ── Customer ── */
  { name: "Signups",           def: "Number of new user registrations in the period" },
  { name: "Churn",             def: "Number of customers who cancelled or stopped using the service" },
  { name: "Churn Rate",        def: "Percentage of customers lost relative to total active users" },
  { name: "NPS",               def: "Net Promoter Score — customer loyalty metric ranging from -100 to +100" },
  { name: "Active_Users",      def: "Users who logged in or engaged with the product within the last 30 days" },
  { name: "Tickets",           def: "Number of customer support tickets created in the period" },
  { name: "Resolution_Rate",   def: "Percentage of support tickets successfully resolved within SLA" },
  { name: "Avg_Handle_Time",   def: "Average time (in seconds) taken to resolve a support ticket" },
  { name: "Week",              def: "Weekly time period label (e.g., W1 Jan, W2 Feb)" },

  /* ── Operations ── */
  { name: "Headcount",         def: "Total number of employees in the department or organisation" },
  { name: "Department",        def: "Business unit or functional team (e.g., Engineering, Marketing, HR)" },
  { name: "Category",          def: "Expense or product category grouping" },

  /* ── Feedback / NLP ── */
  { name: "Sentiment",         def: "Computed sentiment classification of customer feedback (Positive, Neutral, Negative)" },
  { name: "text",              def: "Free-text customer feedback or review content" },

  /* ── Growth ── */
  { name: "Conversion_Rate",   def: "Percentage of leads or visitors who completed a desired action (e.g., purchase)" },
  { name: "Retention_Rate",    def: "Percentage of customers retained from one period to the next" },
  { name: "MRR",               def: "Monthly Recurring Revenue — predictable subscription income per month" },
  { name: "ARR",               def: "Annual Recurring Revenue — total contracted subscription revenue in a year" },
  { name: "CAC",               def: "Customer Acquisition Cost — average cost to acquire one new paying customer" },
  { name: "LTV",               def: "Customer Lifetime Value — total predicted revenue from a single customer" },
  { name: "AOV",               def: "Average Order Value — mean spend per transaction" },
];
