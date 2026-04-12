# InSightify
## Overview

InSightify is an intelligent data interaction platform that allows users to query datasets using natural language. It supports both structured and unstructured data, enabling users to choose the type of data they upload and interact with it accordingly.

The platform introduces a role-based data access system where organizations are divided into teams such as Finance, HR, and Marketing, along with an Owner who has full control. Teams can upload and interact with their own data, while access to restricted company data is managed through an approval workflow controlled by the Owner.

InSightify solves two key problems:
1. It simplifies data analysis by allowing users to ask questions in plain English instead of writing queries.
2. It ensures data privacy and controlled access within organizations by implementing a permission-based system for restricted data.

The platform can be used by individuals (via personal data uploads) or by companies for structured, unstructured, secure, and efficient data exploration.
## Features

### Access Control & Security
- Role-based access system (Owner, Finance, HR, Marketing)
- Column-level data restrictions for sensitive information
- Access request system when restricted data is queried
- Owner approval/denial workflow with real-time updates

### Data Analysis
- Structured data analysis using a deterministic engine (no LLM dependency)
- Supports aggregations (sum, avg, min, max, count)
- Trend analysis, comparisons, ranking, and anomaly detection
- Correlation analysis and custom metric computation

### AI-Powered Querying
- Natural language query support using Groq (llama-3.1-8b-instant)
- Intelligent intent detection (trend, comparison, summary, etc.)
- Context-aware responses for follow-up questions
- Works with unstructured data (text-based datasets)

### Data Handling
- Upload datasets (CSV, Excel, TSV)
- Choose between structured and unstructured data at upload
- Automatic data profiling (column types, stats)
- Built-in company datasets for testing

### Query Execution System
- End-to-end pipeline: query → access check → execution → response
- Multi-step analysis based on user intent
- Smart dataset selection based on query context
- Error handling and fallback mechanisms

### User Interface
- Chat-based interface for interacting with data
- Switch between “Company Data” and “My Data” modes
- Dynamic charts (bar, line, pie, table)
- Suggested questions for quick exploration

### Data Understanding Layer
- Built-in data dictionary with column definitions
- Supports derived metrics (profit, churn rate, etc.)
- Helps map business terms to actual data fields

### Explainability (Trust Layer)
- Shows how results were generated
- Displays datasets used, columns involved, and rows analyzed
- Indicates whether response is AI-powered or deterministic
