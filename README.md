# AI Citation Finder & Generator

Implementation-ready spec for the MVP.

## Product Goal

Build a web app that helps students discover credible academic sources, read short AI-generated summaries, and generate citations in common formats.

The app must work for guests without an account. Logged-in users can save history, sources, and citations.

## MVP Scope

### In Scope

- Search academic sources by topic using OpenAlex.
- Display result cards with title, authors, publication date, citation count, and external link.
- Open a source detail view with summary and citation generator.
- Generate citations without login.
- Support at least MLA and APA citation styles.
- Allow optional authentication with saved history and saved items.

### Out of Scope for MVP

- Full paper reading or PDF parsing.
- Advanced source recommendation beyond ranking by metadata.
- Collaborative features.
- Plagiarism detection.
- Offline mode.

## Primary Users

- High school students.
- College and university students.

## Core User Flows

### Guest Flow

1. User enters a topic.
2. User presses Enter or clicks Search.
3. App fetches sources from OpenAlex.
4. User selects a source.
5. App shows source summary and citation generator.
6. User copies a generated citation without signing in.

### Authenticated Flow

1. User signs up or logs in.
2. User searches for a topic.
3. User views sources, summaries, and citations.
4. User saves sources or citations.
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
- Delete individual saved items.
- Clear all history.
- Permanently delete account.

## Non-Functional Requirements

- Search results should return in under 2 seconds.
- AI summaries should return in under 3 seconds.
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

## Error Handling

- If OpenAlex returns no results, show a friendly empty state and suggest broader search terms.
- If OpenAlex fails, show a retry state.
- If citation generation fails, let the user retry without redoing the search.
- If summary generation fails, still show the source metadata and citation generator.
- If AI summary fails because `AI_API_KEY` is missing, show: "No API key found. Add your API key in settings or .env.local, then retry." and keep a Retry action visible.
- If AI summary fails because credits are exhausted or provider quota is exceeded, show: "API credits exhausted. Recharge or use a different key, then retry." and keep a Retry action visible.

## Acceptance Criteria

### Search

- Given a topic query, the app returns a results list from OpenAlex.
- The user can open a result detail view.
- Search can be triggered by Enter or button click.

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

- The API key is used only for AI-generated summaries and any provider-backed AI features.
- Search and citation formatting should continue to work even if the API key is missing.
- If the key is invalid or missing, the app should show a clear error and fall back to source metadata plus citation generation.
- AI summary requests must provide a Retry action when failures are due to missing key, invalid key, rate limit, or exhausted credits.

## Suggested Build Order

1. Set up the Next.js app shell and responsive layout.
2. Implement OpenAlex search and result cards.
3. Add source detail view.
4. Add citation generation for MLA and APA.
5. Add guest copy flow.
6. Add authentication.
7. Add save history and account management.
8. Add summary generation.
9. Add error states, loading states, and empty states.

## Definition of Done

- A user can search for sources, open a result, read a summary, generate a citation, and copy it.
- Guest mode works end to end.
- Authenticated users can save and manage research data.
- The app has clear loading, error, and empty states.