# InSightify (https://insightify-sigma.vercel.app/)
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
  
## Live Demo
(https://insightify-sigma.vercel.app/)

## Installation & Running the Project(Locally)

### Requirements
- Node.js (v16 or higher recommended)
- Internet connection (for AI queries)

### 1. Clone the repository
```bash
git clone https://github.com/TanishAhuja/talk-to-data.git
cd talk-to-data
```
### 2. Install dependencies
```bash
npm install
```
### 3. Create a .env file in the root directory and add:
```bash
VITE_GROQ_API_KEY=your_api_key_here
```
### 4. Run the development server
```bash
npm run dev
```
## Tech Stack

- **Frontend:** React (Vite)  
- **Styling:** Tailwind CSS  
- **Charts:** Recharts  
- **Icons:** Lucide React  
- **AI Integration:** Groq API (Model: llama-3.1-8b-instant)  
- **State Management:** React Context API  
- **Data Processing:** Custom deterministic analytics engine
- **File Parsing:** CSV/Excel parsing (via browser-based processing)  
## Usage

### 1. Querying Company Data
- Select your role (Owner / Finance / HR / Marketing)
- Ask questions in natural language
- If data is restricted, request access and wait for approval

Example:
"What is the revenue by region?"
"Which month had the worst customer feedback?"

---

### 2. Uploading Your Own Data
- Switch to **My Data**
- Upload a dataset (CSV / Excel / TSV)
- Choose:
  - Structured → for analytical queries
  - Unstructured → for text-based queries
- Ask questions directly

Example:
"When did the user log in?"
"Summarize the error logs"

---

### 3. Understanding Results
- View AI-generated answers and insights
- Explore charts (bar, line, pie, table)
- Check the **Trust Panel** for:
  - datasets used  
  - columns analyzed  
  - method used  

---

## Screenshots
### Main Interface – Chat-Based Data Interaction
<img width="1365" height="678" alt="Screenshot 2026-04-12 230035" src="https://github.com/user-attachments/assets/e3e2019c-4297-49ba-b53c-544e8028f5b8" />
The main interface allows users to interact with data using natural language. Users can select between Company Data and My Data, choose their role, and start asking questions instantly. Suggested queries are also provided to help users explore insights quickly.

### AI-Powered Insights & Answers
<img width="1365" height="685" alt="Screenshot 2026-04-12 223741" src="https://github.com/user-attachments/assets/507409d3-f553-4f2e-b093-35c5297dd682" />
Users can ask questions in natural language and receive structured answers along with key insights. The system not only provides the final answer but also explains the reasoning and highlights important patterns in the data.

### Data Visualization & Charts
<img width="1364" height="681" alt="Screenshot 2026-04-12 223825" src="https://github.com/user-attachments/assets/8680e5ac-2626-48b3-9735-ecc8a35c463c" />
The platform automatically converts analysis results into visual representations such as bar charts. This helps users quickly understand trends, comparisons, and patterns without manually creating graphs.

### Explainability & Trust Panel
<img width="1365" height="684" alt="Screenshot 2026-04-12 223837" src="https://github.com/user-attachments/assets/d2e7670e-ea5c-4390-ab4d-dcc524f9e44e" />
InSightify provides a transparent view of how each answer is generated. Users can see the intent, datasets used, columns analyzed, number of rows processed, and the method applied. This ensures trust and makes the system’s reasoning clear and verifiable.

### Access Control & Permission Request
<img width="1365" height="680" alt="Screenshot 2026-04-12 224044" src="https://github.com/user-attachments/assets/cd0739b0-193a-4b85-bcd4-8a6f5248215b" />
When users try to access restricted data, the system blocks the query and clearly shows which columns are restricted. Users can then request access directly, triggering a workflow where the data owner can approve or deny the request.

### Owner Approval Workflow
<img width="1365" height="682" alt="Screenshot 2026-04-12 225136" src="https://github.com/user-attachments/assets/b8946534-ec97-4791-bcc9-9eeb8f1a43fb" />
Data owners can view all access requests in a dedicated panel and approve or deny them in real time. Once approved, the requesting team gains access instantly, enabling seamless and controlled data sharing.

### Access Granted & Query Execution
<img width="1365" height="685" alt="Screenshot 2026-04-12 224129" src="https://github.com/user-attachments/assets/9c0264c5-bbc7-4683-8b06-ed3478aefdae" />
Once access is approved, users can re-run their query and successfully retrieve results. The system seamlessly removes restrictions and provides insights without requiring any additional steps.

### Upload & Analyze Your Own Data
<img width="1363" height="684" alt="Screenshot 2026-04-12 224147" src="https://github.com/user-attachments/assets/3f3fdfe0-5007-4ed5-8a7f-641e14fea461" />
Users can switch to "My Data" mode and upload their own datasets. The platform allows selecting between structured and unstructured data, enabling flexible analysis based on the nature of the dataset.

### Unstructured Data Querying
<img width="1363" height="681" alt="Screenshot 2026-04-12 224321" src="https://github.com/user-attachments/assets/df58d7e7-34d9-45fe-8f39-ffcbc29e2aa2" />
InSightify also supports unstructured datasets such as logs or text data. Users can upload such data and ask natural language questions, with the system extracting relevant information and generating meaningful answers.

## Architecture

User Query → LLM → Intent Detection → Access Control → Execution → Response → Output

InSightify follows a hybrid architecture combining AI-based query understanding with a deterministic analytics engine.

1. **Query Understanding (LLM)**
   - Natural language queries are processed using Groq (llama-3.1-8b-instant)
   - The system identifies intent (trend, comparison, summary, etc.)

2. **Access Control Layer**
   - Role-based and column-level permissions are validated
   - Restricted queries trigger an access request workflow

3. **Execution Engine**
   - Structured data is processed using a deterministic analysis engine
   - Unstructured data is handled using AI-based processing

4. **Response Generation**
   - Results are converted into human-readable insights
   - Charts and visualizations are generated automatically

5. **Explainability Layer**
   - Displays datasets used, columns analyzed, and methods applied
   - Ensures transparency and trust in results

## Limitations

- No authentication system (roles are manually selected for now)
- Unstructured data analysis depends on LLM accuracy
- Requires internet connection for AI-based queries
- Conversation context is not maintained across the entire chat history

## Future Improvements

- Add user authentication and role management
- Enhance NLP capabilities for more complex queries
- Maintain full conversation context across chat history
- Provide intelligent suggestions and contextual recommendations based on chat history
  
## Deployment

The project is deployed on Vercel:

https://insightify-sigma.vercel.app/






