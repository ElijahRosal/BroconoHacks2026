# AI Citation Finder & Generator

Implementation-ready spec for the MVP.

## Product Goal

Build a web app that helps students discover credible academic sources, read short AI-generated summaries, and generate citations in common formats.

The app must work for guests without an account. Logged-in users can save history, sources, and citations.

## MVP Scope

### In Scope

- Search academic sources by topic using OpenAlex.
- Three user start modes: Regular Query, Query-to-research-plan, and Claim-to-source.
- Display result cards with title, authors, publication date, citation count, and external link.
- Open a source detail view with summary and citation generator.
- Generate citations without login.
- Support at least MLA and APA citation styles.
- Allow optional authentication with saved history and saved items.

### Out of Scope for MVP

- Full paper reading or PDF parsing.
- Collaborative features.
- Plagiarism detection.
- Offline mode.

## Primary Users

- High school students.
- College and university students.

## Core User Flows

### Start Modes

The search entry screen must present exactly three start options:

1. Regular Query
2. Query-to-research-plan
3. Claim-to-source

### Guest Flow

1. User enters a topic.
2. User presses Enter or clicks Search.
3. App fetches sources from OpenAlex.
4. User selects a source.
5. App shows source summary and citation generator.
6. User copies a generated citation without signing in.

### Guest Flow (Query-to-research-plan Start)

1. User enters a topic and selects Query-to-research-plan start mode.
2. App runs Query-to-research-plan to produce a refined research question, suggested queries, and keywords.
3. User chooses one suggested query or continues with the refined query.
4. App fetches sources from OpenAlex.
5. User opens a source detail view, generates a citation, and copies it.

### Guest Flow (Claim-to-source Start)

1. User enters a claim or thesis statement and selects Claim-to-source start mode.
2. App extracts keywords and generates one or more retrieval queries from the claim.
3. App fetches sources from OpenAlex.
4. App ranks sources by claim match score and displays rationale and confidence.
5. User opens a source detail view, generates a citation, and copies it.

### Authenticated Flow

1. User signs up or logs in.
2. User searches for a topic.
3. User views sources, summaries, and citations.
4. User saves sources or citations.
5. User views and clears history or deletes account.

### Authenticated Flow (Query-to-research-plan Start)

1. User signs up or logs in.
2. User enters a topic and selects Query-to-research-plan start mode.
3. App runs Query-to-research-plan and returns refined query options.
4. User runs search and reviews results.
5. User saves sources, citations, and optional enhanced-query artifacts.
6. User views and clears history or deletes account.

### Authenticated Flow (Claim-to-source Start)

1. User signs up or logs in.
2. User enters a claim and selects Claim-to-source start mode.
3. App retrieves and ranks sources by claim match.
4. User saves sources, citations, and claim match results.
5. User views and clears history or deletes account.

## Functional Requirements

### Search and Discovery

- Input: a search query string from the user.
- Trigger: Enter key or Search button.
- Data source: OpenAlex API.
- Result fields:
	- Title
	- Authors
	- Publication date
	- Citation count
	- External link to source

### Search Start Modes

- The search UI must include a required start mode selector with three options:
	- Regular Query
	- Query-to-research-plan
	- Claim-to-source
- Default start mode: Regular Query.
- Each start mode must be executable independently from the first user action.

### Query-to-research-plan (Optional)

- Users can run Query-to-research-plan before fetching sources.
- Query-to-research-plan output must include:
	- Refined research question
	- Suggested search queries (minimum 3)
	- Topical keywords and synonyms
- Users can choose any suggested query or keep their original query.

### Claim-to-source (Optional)

- Users can run Claim-to-source as a direct start mode by entering a claim or thesis statement first.
- Claim-to-source flow must include retrieval of sources from OpenAlex before ranking claim matches.
- Claim-to-source output must include:
	- Ranked matching sources
	- Short rationale for each match grounded in source metadata and/or summary
	- Confidence indicator (High, Medium, Low)
- If either optional AI start mode is unavailable, Regular Query must still work unchanged.

### Result Ranking

Rank results using the following priority:

1. Relevance to the search query.
2. Higher citation count.
3. More recent publication date.

If the ranking logic cannot be fully determined, use OpenAlex relevance first and then sort by citation count descending.
If citation count is missing for a source, treat it as `0`.

### Source Detail View

Selecting a result opens a detail view with:

- AI-generated summary.
- Source metadata.
- Link to the original paper or landing page.
- Citation format selector.
- Generate Citation button.

### Citation Generation

- Works for guests and authenticated users.
- Default citation style: MLA.
- Supported styles for MVP: MLA, APA, Chicago, IEEE, and Harvard.
- Citation engine for MVP: `citation-js` (required dependency).
- Output must be copyable.
- Output must include a small label or indicator for the selected style.

### Guest Local Storage

- Guest citation history is stored locally in the browser.
- Local history includes citation text, selected style, source title, and created timestamp.
- Guests can clear local citation history from the UI.
- Local storage key: `acfg_guest_citation_history_v1`.
- Storage schema (JSON array):

```json
[
	{
		"id": "string",
		"sourceId": "string",
		"sourceTitle": "string",
		"style": "MLA",
		"citationText": "string",
		"createdAt": "2026-04-25T12:00:00.000Z"
	}
]
```

### Authentication

- Sign up with email and password.
- Email verification required before account activation.
- Use NextAuth.js for authentication flows.
- Email verification service for MVP: Resend (free tier).

### Saved Data for Authenticated Users

- Save search history.
- Save citations.
- Save sources.
- Save start mode history and optional AI artifacts (refined question, selected suggested query, and claim-to-source runs).
- Delete individual saved items.
- Clear all history.
- Permanently delete account.

## Non-Functional Requirements

- Search results should return in under 2 seconds.
- AI summaries should return in under 3 seconds.
- Query-to-research-plan should return in under 3 seconds.
- Claim-to-source matching should return in under 3 seconds for up to 50 search results.
- UI must be mobile responsive.
- Session handling must be secure.
- External links must open safely.
- The app should support thousands of concurrent users at the architecture level.

## Data Model Draft

### User

- id
- email
- passwordHash or auth provider identifier
- emailVerified
- createdAt
- updatedAt

### SearchHistoryItem

- id
- userId
- query
- createdAt

### EnhancedQueryItem

- id
- userId
- originalQuery
- refinedQuestion
- suggestedQueries
- selectedQuery
- claimText
- claimMatches
- createdAt

### SavedSource

- id
- userId
- openAlexId
- title
- authors
- publicationDate
- citationCount
- externalUrl
- summary
- createdAt

### SavedCitation

- id
- userId
- sourceId or openAlexId
- style
- citationText
- createdAt

## API Contract Draft

### `GET /api/search?q=`

Returns a list of source objects with the following shape:

```json
{
	"id": "string",
	"title": "string",
	"authors": ["string"],
	"publicationDate": "string",
	"citationCount": 0,
	"externalUrl": "string",
	"summary": "string"
}
```

### `POST /api/research-plan`

Optional Query-to-research-plan endpoint.

Request body:

```json
{
	"query": "string"
}
```

Response body:

```json
{
	"refinedQuestion": "string",
	"suggestedQueries": ["string"],
	"keywords": ["string"],
	"synonyms": ["string"]
}
```

### `POST /api/claim-match`

Optional Claim-to-source endpoint.

Request body:

```json
{
	"claim": "string",
	"sources": [
		{
			"id": "string",
			"title": "string",
			"authors": ["string"],
			"publicationDate": "string",
			"citationCount": 0,
			"summary": "string"
		}
	]
}
```

Response body:

```json
{
	"matches": [
		{
			"sourceId": "string",
			"score": 0.0,
			"confidence": "High",
			"rationale": "string"
		}
	]
}
```

### `POST /api/citation`

Request body:

```json
{
	"source": {},
	"style": "MLA"
}
```

Response body:

```json
{
	"citationText": "string",
	"style": "MLA"
}
```

### `POST /api/save-source`

Requires authentication.

### `POST /api/save-citation`

Requires authentication.

### `DELETE /api/history`

Requires authentication. Clears all search history for the current user.

### `DELETE /api/account`

Requires authentication. Permanently deletes the account and related user data.

## AI Summary Rules

- Summaries must be short, neutral, and source-grounded.
- If the summary is generated from metadata only, it must not claim findings that are not supported by the metadata.
- The original source link must always be shown next to the summary.
- The summary should answer: what the source is about, why it is relevant, and one or two key topical keywords.

## Enhanced AI Query Rules

- Query-to-research-plan suggestions must be neutral and focused on search effectiveness.
- Claim-to-source rationale must be grounded in available source metadata and/or generated summary.
- Claim-to-source must not assert that a source proves a claim when evidence is uncertain; it should indicate uncertainty through confidence.
- Enhanced outputs must always preserve access to the original source link and metadata.
- Claim-to-source start mode must support direct entry of a claim without requiring a prior topic search.

## Error Handling

- If OpenAlex returns no results, show a friendly empty state and suggest broader search terms.
- If OpenAlex fails, show a retry state.
- If citation generation fails, let the user retry without redoing the search.
- If summary generation fails, still show the source metadata and citation generator.
- If AI summary fails because `AI_API_KEY` is missing, show: "No API key found. Add your API key in settings or .env.local, then retry." and keep a Retry action visible.
- If AI summary fails because credits are exhausted or provider quota is exceeded, show: "API credits exhausted. Recharge or use a different key, then retry." and keep a Retry action visible.
- If Query-to-research-plan fails, fall back to standard search input and keep Search action available.
- If Claim-to-source fails, keep the source list visible and allow retry without re-running search.
- If Claim-to-source fails before retrieval completes, show retry and allow switching to Regular Query without losing user input.

## Acceptance Criteria

### Search

- Given a topic query, the app returns a results list from OpenAlex.
- The user can open a result detail view.
- Search can be triggered by Enter or button click.

### Optional AI Start Modes

- The user can start from exactly one of three modes: Regular Query, Query-to-research-plan, or Claim-to-source.
- Given a topic query with Query-to-research-plan selected, the app returns a refined research question and at least 3 suggested queries.
- The user can pick a suggested query and run search results successfully.
- Given Claim-to-source selected as the initial mode, the user can submit a claim and receive ranked matching sources with rationale and confidence.
- If optional AI mode endpoints fail, Regular Query and citation flows remain usable.

### Citation Generation

- The user can generate a citation without logging in.
- The user can switch citation styles before generating.
- The generated citation can be copied.
- The user can generate citations in MLA, APA, Chicago, IEEE, and Harvard formats.

### Guest Local History

- A guest user's citation history is saved in browser local storage.
- A guest user can clear local citation history.
- Guest history uses key `acfg_guest_citation_history_v1` and persists across browser sessions on the same device.

### Authenticated Features

- A logged-in user can save a source.
- A logged-in user can save a citation.
- A logged-in user can clear history.
- A logged-in user can delete their account.

## Technical Stack

- Frontend: Next.js
- Backend: Next.js API routes
- Runtime: Node.js
- Database: MongoDB
- Search API: OpenAlex
- Auth: NextAuth.js
- Email verification: Resend (free tier)
- Citation formatting: citation-js
- AI summaries: user-supplied API key for the chosen AI provider
- AI start mode tools: Query-to-research-plan and Claim-to-source using user-supplied AI provider key

## API Key Setup

The app should let each user provide their own API key for AI-powered features.

### Recommended Environment Variables

- `AI_API_KEY`: the user's personal AI provider key
- `AI_API_BASE_URL`: optional, for non-default or OpenAI-compatible providers
- `AI_MODEL`: optional, the model name to use for summaries
- `RESEND_API_KEY`: API key for email verification and transactional auth emails
- `EMAIL_FROM`: verified sender address for verification emails

### Setup Steps

1. Create a local environment file named `.env.local` in the project root.
2. Add the API key and any provider-specific values.
3. If the project includes an example file such as `.env.example`, copy the same variable names from there.
4. Restart the development server after changing environment variables.

Example:

```bash
AI_API_KEY=your_personal_key_here
AI_API_BASE_URL=https://api.openai.com/v1
AI_MODEL=gpt-4o-mini
RESEND_API_KEY=your_resend_api_key
EMAIL_FROM=no-reply@yourdomain.com
```

## Setup And Run

### Prerequisites

- Node.js installed.
- MongoDB connection string available.
- A personal AI API key for summary generation.
- A Resend account and API key for email verification.

### Local Setup

1. Install dependencies.
2. Create `.env.local`.
3. Add `MONGODB_URI`, `NEXTAUTH_SECRET`, AI key variables, and Resend email variables.
4. Start the development server.

### Run Commands

If the project uses the standard Next.js scripts, run:

```bash
npm install
npm run dev
```

### How The API Key Is Used

- The API key is used for AI-generated summaries and optional enhanced query features.
- Search and citation formatting should continue to work even if the API key is missing.
- If the key is invalid or missing, the app should show a clear error and fall back to source metadata plus citation generation.
- AI summary and optional AI start mode requests must provide a Retry action when failures are due to missing key, invalid key, rate limit, or exhausted credits.

## Suggested Build Order

1. Set up the Next.js app shell and responsive layout.
2. Implement OpenAlex search and result cards.
3. Add source detail view.
4. Add citation generation for MLA and APA.
5. Add guest copy flow.
6. Add authentication.
7. Add save history and account management.
8. Add summary generation.
9. Add two AI start modes (Query-to-research-plan and Claim-to-source) from the initial search screen.
10. Add error states, loading states, and empty states.

## Definition of Done

- A user can search for sources, open a result, read a summary, generate a citation, and copy it.
- A user can begin with one of three start modes: Regular Query, Query-to-research-plan, or Claim-to-source.
- Guest mode works end to end.
- Authenticated users can save and manage research data.
- The app has clear loading, error, and empty states.
