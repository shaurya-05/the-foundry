const fs = require("fs");
const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  Header, Footer, AlignmentType, HeadingLevel, BorderStyle, WidthType,
  ShadingType, PageNumber, PageBreak, LevelFormat, ExternalHyperlink,
  TableOfContents,
} = require("docx");

// Brand colors
const RED = "D12D1F";
const GOLD = "D4A017";
const BLUE = "5B93ED";
const DARK = "0A0C12";
const GRAY = "6B7280";
const LIGHT_BG = "F9FAFB";
const BORDER_COLOR = "E5E7EB";

const border = { style: BorderStyle.SINGLE, size: 1, color: BORDER_COLOR };
const borders = { top: border, bottom: border, left: border, right: border };
const cellMargins = { top: 80, bottom: 80, left: 120, right: 120 };

// Page dimensions (US Letter)
const PAGE_WIDTH = 12240;
const MARGIN = 1440;
const CONTENT_WIDTH = PAGE_WIDTH - 2 * MARGIN; // 9360

function heading(text, level = HeadingLevel.HEADING_1) {
  return new Paragraph({ heading: level, children: [new TextRun(text)] });
}

function body(text, opts = {}) {
  return new Paragraph({
    spacing: { after: 120 },
    ...opts,
    children: [new TextRun({ font: "Arial", size: 22, color: DARK, ...opts.run, text })],
  });
}

function boldBody(label, text) {
  return new Paragraph({
    spacing: { after: 120 },
    children: [
      new TextRun({ font: "Arial", size: 22, color: DARK, bold: true, text: label }),
      new TextRun({ font: "Arial", size: 22, color: DARK, text }),
    ],
  });
}

function spacer() {
  return new Paragraph({ spacing: { after: 200 }, children: [] });
}

// Feature table helper
function featureRow(feature, description, headerRow = false) {
  const fill = headerRow ? RED : "FFFFFF";
  const textColor = headerRow ? "FFFFFF" : DARK;
  const bold = headerRow;
  return new TableRow({
    children: [
      new TableCell({
        borders, width: { size: 2800, type: WidthType.DXA },
        shading: { fill, type: ShadingType.CLEAR },
        margins: cellMargins,
        children: [new Paragraph({ children: [new TextRun({ text: feature, bold, color: textColor, font: "Arial", size: 20 })] })],
      }),
      new TableCell({
        borders, width: { size: 6560, type: WidthType.DXA },
        shading: { fill: headerRow ? RED : LIGHT_BG, type: ShadingType.CLEAR },
        margins: cellMargins,
        children: [new Paragraph({ children: [new TextRun({ text: description, bold, color: textColor, font: "Arial", size: 20 })] })],
      }),
    ],
  });
}

const doc = new Document({
  styles: {
    default: { document: { run: { font: "Arial", size: 22 } } },
    paragraphStyles: [
      {
        id: "Heading1", name: "Heading 1", basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { size: 36, bold: true, font: "Arial", color: DARK },
        paragraph: { spacing: { before: 360, after: 200 }, outlineLevel: 0 },
      },
      {
        id: "Heading2", name: "Heading 2", basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { size: 28, bold: true, font: "Arial", color: RED },
        paragraph: { spacing: { before: 280, after: 160 }, outlineLevel: 1 },
      },
      {
        id: "Heading3", name: "Heading 3", basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { size: 24, bold: true, font: "Arial", color: DARK },
        paragraph: { spacing: { before: 200, after: 120 }, outlineLevel: 2 },
      },
    ],
  },
  numbering: {
    config: [
      {
        reference: "bullets",
        levels: [{
          level: 0, format: LevelFormat.BULLET, text: "\u2022", alignment: AlignmentType.LEFT,
          style: { paragraph: { indent: { left: 720, hanging: 360 } } },
        }],
      },
      {
        reference: "numbers",
        levels: [{
          level: 0, format: LevelFormat.DECIMAL, text: "%1.", alignment: AlignmentType.LEFT,
          style: { paragraph: { indent: { left: 720, hanging: 360 } } },
        }],
      },
    ],
  },
  sections: [
    // ─── COVER PAGE ────────────────────────────────────────────────────
    {
      properties: {
        page: {
          size: { width: PAGE_WIDTH, height: 15840 },
          margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 },
        },
      },
      children: [
        spacer(), spacer(), spacer(), spacer(), spacer(),
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { after: 80 },
          children: [
            new TextRun({ text: "The ", font: "Arial", size: 72, bold: true, color: BLUE }),
            new TextRun({ text: "FOUND", font: "Arial", size: 72, bold: true, color: RED }),
            new TextRun({ text: "3", font: "Arial", size: 72, bold: true, color: GOLD }),
            new TextRun({ text: "RY", font: "Arial", size: 72, bold: true, color: RED }),
          ],
        }),
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { after: 40 },
          children: [
            new TextRun({ text: "by ", font: "Arial", size: 24, color: GRAY }),
            new TextRun({ text: "h", font: "Arial", size: 24, bold: true, color: "2563EB" }),
            new TextRun({ text: "3", font: "Arial", size: 24, bold: true, color: "F97316" }),
            new TextRun({ text: "ros", font: "Arial", size: 24, bold: true, color: "2563EB" }),
          ],
        }),
        spacer(),
        new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [new TextRun({ text: "AI-Powered Builder Operating System", font: "Arial", size: 32, color: GRAY })],
        }),
        spacer(),
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { after: 60 },
          children: [new TextRun({ text: "Version 1.0 Product Overview", font: "Arial", size: 28, bold: true, color: DARK })],
        }),
        new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [new TextRun({ text: "April 2026", font: "Arial", size: 22, color: GRAY })],
        }),
        spacer(), spacer(), spacer(), spacer(), spacer(), spacer(),
        new Paragraph({
          alignment: AlignmentType.CENTER,
          border: { top: { style: BorderStyle.SINGLE, size: 2, color: RED } },
          spacing: { before: 200 },
          children: [new TextRun({ text: "found3ry.com", font: "Arial", size: 24, bold: true, color: RED })],
        }),
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { after: 60 },
          children: [new TextRun({ text: "Confidential", font: "Arial", size: 18, italics: true, color: GRAY })],
        }),
      ],
    },

    // ─── TABLE OF CONTENTS ─────────────────────────────────────────────
    {
      properties: {
        page: {
          size: { width: PAGE_WIDTH, height: 15840 },
          margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 },
        },
      },
      headers: {
        default: new Header({
          children: [new Paragraph({
            alignment: AlignmentType.RIGHT,
            children: [
              new TextRun({ text: "The ", font: "Arial", size: 16, color: BLUE }),
              new TextRun({ text: "FOUND", font: "Arial", size: 16, color: RED }),
              new TextRun({ text: "3", font: "Arial", size: 16, color: GOLD }),
              new TextRun({ text: "RY", font: "Arial", size: 16, color: RED }),
              new TextRun({ text: "  |  V1 Product Overview", font: "Arial", size: 16, color: GRAY }),
            ],
          })],
        }),
      },
      footers: {
        default: new Footer({
          children: [new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [
              new TextRun({ text: "Page ", font: "Arial", size: 16, color: GRAY }),
              new TextRun({ children: [PageNumber.CURRENT], font: "Arial", size: 16, color: GRAY }),
            ],
          })],
        }),
      },
      children: [
        heading("Table of Contents"),
        new TableOfContents("Table of Contents", { hyperlink: true, headingStyleRange: "1-3" }),
        new Paragraph({ children: [new PageBreak()] }),

        // ─── 1. EXECUTIVE SUMMARY ───────────────────────────────────────
        heading("Executive Summary"),
        body("The FOUND3RY is an AI co-founder platform that takes builders from raw idea to fully planned, task-tracked build with artificial intelligence doing the heavy lifting at every step. It is a strategic partner that never sleeps, knows the entire workspace, and can generate investor-ready plans in minutes."),
        spacer(),
        body("Version 1 is live and globally accessible at found3ry.com. The platform combines AI-powered project planning, strategic analysis, knowledge management, and team collaboration into a single integrated operating system designed for founders, innovators, and teams building the next big thing."),
        spacer(),
        boldBody("Core Value Proposition: ", "Eliminate the gap between having an idea and executing on it by providing AI-driven structure, analysis, and planning at every stage of the build lifecycle."),
        new Paragraph({ children: [new PageBreak()] }),

        // ─── 2. PLATFORM ARCHITECTURE ────────────────────────────────────
        heading("Platform Architecture"),
        body("The FOUND3RY is built on a modern, scalable stack designed for real-time collaboration and AI-native workflows:"),
        spacer(),

        new Table({
          width: { size: CONTENT_WIDTH, type: WidthType.DXA },
          columnWidths: [2800, 6560],
          rows: [
            featureRow("Component", "Technology", true),
            featureRow("Frontend", "Next.js 15, TypeScript, Tailwind CSS, Framer Motion"),
            featureRow("Backend", "FastAPI (Python), asyncpg, Redis, PostgreSQL with pgvector"),
            featureRow("AI Engine", "Anthropic Claude (streaming via SSE), Voyage AI embeddings"),
            featureRow("Real-time", "WebSocket connections for canvas collaboration and notifications"),
            featureRow("Hosting", "Vercel (frontend CDN) + Railway (backend + databases)"),
            featureRow("Email", "Resend transactional email with custom domain"),
            featureRow("Security", "JWT auth, bcrypt, rate limiting, CORS, HSTS, request tracing"),
          ],
        }),
        new Paragraph({ children: [new PageBreak()] }),

        // ─── 3. CORE FEATURES ────────────────────────────────────────────
        heading("Core Features"),

        // 3.1 AI Project Generation
        heading("AI Project Generation", HeadingLevel.HEADING_2),
        body("The flagship feature of The FOUND3RY. Users type a project name and the platform generates a comprehensive project plan using Claude AI with streaming output. The generation is fully configurable through a checkbox modal that lets users select exactly which sections to include."),
        spacer(),
        heading("Plan Sections Available:", HeadingLevel.HEADING_3),
        new Paragraph({ numbering: { reference: "bullets", level: 0 }, children: [new TextRun({ font: "Arial", size: 22, text: "Overview \u2014 high-level description of the project and its purpose" })] }),
        new Paragraph({ numbering: { reference: "bullets", level: 0 }, children: [new TextRun({ font: "Arial", size: 22, text: "Core Objectives \u2014 3-5 measurable goals the project aims to achieve" })] }),
        new Paragraph({ numbering: { reference: "bullets", level: 0 }, children: [new TextRun({ font: "Arial", size: 22, text: "Key Milestones \u2014 phased timeline with specific deliverables" })] }),
        new Paragraph({ numbering: { reference: "bullets", level: 0 }, children: [new TextRun({ font: "Arial", size: 22, text: "Technical Requirements \u2014 stack, infrastructure, and integration needs" })] }),
        new Paragraph({ numbering: { reference: "bullets", level: 0 }, children: [new TextRun({ font: "Arial", size: 22, text: "Success Criteria \u2014 KPIs and metrics that define project success" })] }),
        new Paragraph({ numbering: { reference: "bullets", level: 0 }, children: [new TextRun({ font: "Arial", size: 22, text: "Auto-Generated Tasks \u2014 actionable task list with priorities, auto-populated to the kanban board" })] }),
        spacer(),
        body("All AI output is streamed in real-time, providing immediate feedback as the plan is being constructed. Tasks are automatically created in the task board with appropriate priority levels (critical, high, medium, low)."),
        spacer(),

        // 3.2 Launch Brief Generator
        heading("Launch Brief Generator", HeadingLevel.HEADING_2),
        body("For users seeking investor-ready analysis, the Launch Brief Generator produces a comprehensive startup brief from a single concept description. This is accessed via the \"Generate from Concept\" button and produces a document suitable for pitch decks, advisor meetings, and fundraising conversations."),
        spacer(),
        heading("Brief Sections Available:", HeadingLevel.HEADING_3),
        new Paragraph({ numbering: { reference: "bullets", level: 0 }, children: [new TextRun({ font: "Arial", size: 22, text: "The Pitch \u2014 one-paragraph elevator pitch" })] }),
        new Paragraph({ numbering: { reference: "bullets", level: 0 }, children: [new TextRun({ font: "Arial", size: 22, text: "The Problem \u2014 market pain points with data-backed evidence" })] }),
        new Paragraph({ numbering: { reference: "bullets", level: 0 }, children: [new TextRun({ font: "Arial", size: 22, text: "The Solution \u2014 product design with technical differentiation" })] }),
        new Paragraph({ numbering: { reference: "bullets", level: 0 }, children: [new TextRun({ font: "Arial", size: 22, text: "Target Market \u2014 TAM/SAM/SOM sizing with segment analysis" })] }),
        new Paragraph({ numbering: { reference: "bullets", level: 0 }, children: [new TextRun({ font: "Arial", size: 22, text: "MVP Feature Set \u2014 minimum viable product scope" })] }),
        new Paragraph({ numbering: { reference: "bullets", level: 0 }, children: [new TextRun({ font: "Arial", size: 22, text: "Go-To-Market Strategy \u2014 30/60/90-day launch plan with channels" })] }),
        new Paragraph({ numbering: { reference: "bullets", level: 0 }, children: [new TextRun({ font: "Arial", size: 22, text: "Key Metrics \u2014 targets at 30, 60, and 90 days with north star metric" })] }),
        new Paragraph({ numbering: { reference: "bullets", level: 0 }, children: [new TextRun({ font: "Arial", size: 22, text: "Funding Path \u2014 recommended raise amount, investor profile, and timeline" })] }),
        spacer(),

        // 3.3 COFOUND3R
        heading("COFOUND3R \u2014 AI Co-Founder Assistant", HeadingLevel.HEADING_2),
        body("COFOUND3R is an AI assistant accessible anywhere in the platform via Cmd+J (or Ctrl+J on Windows). Unlike generic chatbots, COFOUND3R has complete situational awareness of the entire workspace:"),
        spacer(),
        new Paragraph({ numbering: { reference: "bullets", level: 0 }, children: [new TextRun({ font: "Arial", size: 22, text: "Sees every project by name with plan excerpts and status" })] }),
        new Paragraph({ numbering: { reference: "bullets", level: 0 }, children: [new TextRun({ font: "Arial", size: 22, text: "Knows every open task with priority levels and due dates" })] }),
        new Paragraph({ numbering: { reference: "bullets", level: 0 }, children: [new TextRun({ font: "Arial", size: 22, text: "Has access to all knowledge base items with content summaries" })] }),
        new Paragraph({ numbering: { reference: "bullets", level: 0 }, children: [new TextRun({ font: "Arial", size: 22, text: "Tracks all ideas and their SWOT analysis status" })] }),
        new Paragraph({ numbering: { reference: "bullets", level: 0 }, children: [new TextRun({ font: "Arial", size: 22, text: "Monitors recent activity events across the workspace" })] }),
        spacer(),
        body("When inside a specific project, COFOUND3R switches to project-specific context with full visibility into that project\u2019s plan, tasks, notes, and related knowledge items. This enables precise, actionable advice that references actual items by name."),
        spacer(),

        // 3.4 Knowledge Base
        heading("Knowledge Base with Semantic Search", HeadingLevel.HEADING_2),
        body("The Knowledge Base is a research library where users store notes, documents, links, and reference materials. Every item is processed by the AI to generate:"),
        spacer(),
        new Paragraph({ numbering: { reference: "bullets", level: 0 }, children: [new TextRun({ font: "Arial", size: 22, text: "Automatic summaries for quick scanning" })] }),
        new Paragraph({ numbering: { reference: "bullets", level: 0 }, children: [new TextRun({ font: "Arial", size: 22, text: "Vector embeddings (via Voyage AI) stored in pgvector for semantic search" })] }),
        new Paragraph({ numbering: { reference: "bullets", level: 0 }, children: [new TextRun({ font: "Arial", size: 22, text: "Full-text search using PostgreSQL tsvector for keyword matching" })] }),
        spacer(),
        body("The semantic search capability means users can search by meaning rather than exact keywords. A query for \u201Ccustomer acquisition strategies\u201D will surface relevant items even if those exact words never appear in the content. Results include similarity scores showing how closely each item relates to the query."),
        spacer(),

        // 3.5 Ideas Lab
        heading("Ideas Lab with SWOT Analysis", HeadingLevel.HEADING_2),
        body("The Ideas Lab generates three distinct startup or project ideas for any given domain or problem space. Each idea includes a one-line pitch, core problem solved, unique mechanism, and market timing analysis."),
        spacer(),
        body("Any saved idea can then be evaluated with a full SWOT Analysis that is streamed in real-time:"),
        spacer(),
        new Paragraph({ numbering: { reference: "bullets", level: 0 }, children: [new TextRun({ font: "Arial", size: 22, text: "Strengths \u2014 3-4 internal advantages" })] }),
        new Paragraph({ numbering: { reference: "bullets", level: 0 }, children: [new TextRun({ font: "Arial", size: 22, text: "Weaknesses \u2014 3-4 internal limitations" })] }),
        new Paragraph({ numbering: { reference: "bullets", level: 0 }, children: [new TextRun({ font: "Arial", size: 22, text: "Opportunities \u2014 3-4 external factors to capitalize on" })] }),
        new Paragraph({ numbering: { reference: "bullets", level: 0 }, children: [new TextRun({ font: "Arial", size: 22, text: "Threats \u2014 3-4 external risks" })] }),
        new Paragraph({ numbering: { reference: "bullets", level: 0 }, children: [new TextRun({ font: "Arial", size: 22, text: "Overall Score \u2014 1-10 rating with justification" })] }),
        new Paragraph({ numbering: { reference: "bullets", level: 0 }, children: [new TextRun({ font: "Arial", size: 22, text: "Recommended Next Step \u2014 one specific, actionable recommendation" })] }),
        spacer(),
        body("SWOT analyses are cached in the idea\u2019s metadata so they persist and can be viewed without regenerating."),
        spacer(),

        // 3.6 Task Board
        heading("Kanban Task Board", HeadingLevel.HEADING_2),
        body("All tasks \u2014 whether auto-generated from project plans or manually created \u2014 are managed on a drag-and-drop kanban board with five columns:"),
        spacer(),
        new Table({
          width: { size: CONTENT_WIDTH, type: WidthType.DXA },
          columnWidths: [1872, 1872, 1872, 1872, 1872],
          rows: [
            new TableRow({
              children: ["Backlog", "To Do", "In Progress", "In Review", "Completed"].map(col =>
                new TableCell({
                  borders, width: { size: 1872, type: WidthType.DXA },
                  shading: { fill: RED, type: ShadingType.CLEAR },
                  margins: cellMargins,
                  children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: col, bold: true, color: "FFFFFF", font: "Arial", size: 18 })] })],
                })
              ),
            }),
          ],
        }),
        spacer(),
        body("Each task includes priority levels (critical, high, medium, low), descriptions, due dates, project association, and assignee tracking. Tasks can be assigned to team members and filtered by project or status."),
        spacer(),

        // 3.7 AI Agents
        heading("Specialized AI Agents", HeadingLevel.HEADING_2),
        body("Four specialized AI agents are available for deep analysis work:"),
        spacer(),
        new Table({
          width: { size: CONTENT_WIDTH, type: WidthType.DXA },
          columnWidths: [2400, 6960],
          rows: [
            featureRow("Agent", "Capability", true),
            featureRow("Field Analyst", "Deep market research, competitive landscape analysis, industry trend identification, and data-driven market insights"),
            featureRow("Systems Architect", "Technical architecture design, system component planning, infrastructure recommendations, and scalability analysis"),
            featureRow("Market Scout", "Opportunity identification, emerging market analysis, partnership potential assessment, and trend forecasting"),
            featureRow("Launch Strategist", "Go-to-market planning, positioning strategy, channel optimization, and launch timeline development"),
          ],
        }),
        spacer(),
        body("Agents can be run individually or chained together into multi-step pipelines for comprehensive analysis workflows. Each agent\u2019s output is stored and accessible for future reference."),
        spacer(),

        // 3.8 Blueprint Canvas
        heading("Blueprint Canvas", HeadingLevel.HEADING_2),
        body("The Blueprint Canvas is a visual, spatial workspace for mapping out ideas, connecting projects, and organizing thinking. It supports:"),
        spacer(),
        new Paragraph({ numbering: { reference: "bullets", level: 0 }, children: [new TextRun({ font: "Arial", size: 22, text: "Multiple node types: Note, Project, Idea, Knowledge, Custom" })] }),
        new Paragraph({ numbering: { reference: "bullets", level: 0 }, children: [new TextRun({ font: "Arial", size: 22, text: "Real-time collaboration via WebSocket with live presence indicators" })] }),
        new Paragraph({ numbering: { reference: "bullets", level: 0 }, children: [new TextRun({ font: "Arial", size: 22, text: "Pan, zoom, and drag interactions for spatial organization" })] }),
        new Paragraph({ numbering: { reference: "bullets", level: 0 }, children: [new TextRun({ font: "Arial", size: 22, text: "Auto-save with debounce (1.5 second timer)" })] }),
        new Paragraph({ numbering: { reference: "bullets", level: 0 }, children: [new TextRun({ font: "Arial", size: 22, text: "Visibility controls (private, team, or public)" })] }),
        spacer(),

        // 3.9 Dashboard Intelligence
        heading("Dashboard Intelligence", HeadingLevel.HEADING_2),
        body("The Dashboard provides a command center view of the entire workspace with AI-powered intelligence:"),
        spacer(),
        new Paragraph({ numbering: { reference: "bullets", level: 0 }, children: [new TextRun({ font: "Arial", size: 22, text: "Velocity Tracking \u2014 tasks completed this week versus last week with trend direction (up/down/flat)" })] }),
        new Paragraph({ numbering: { reference: "bullets", level: 0 }, children: [new TextRun({ font: "Arial", size: 22, text: "Project Health Scores \u2014 per-project health calculated from blocked and overdue task ratios (healthy, at risk, critical)" })] }),
        new Paragraph({ numbering: { reference: "bullets", level: 0 }, children: [new TextRun({ font: "Arial", size: 22, text: "Attention Items \u2014 top 5 items needing immediate action: overdue tasks, blocked tasks, projects with no tasks" })] }),
        new Paragraph({ numbering: { reference: "bullets", level: 0 }, children: [new TextRun({ font: "Arial", size: 22, text: "Active project counts, open task counts, and recent activity feed" })] }),
        spacer(),

        // 3.10 Team Workspaces
        heading("Team Workspaces (In Progress)", HeadingLevel.HEADING_2),
        body("Workspace collaboration with role-based access control:"),
        spacer(),
        new Table({
          width: { size: CONTENT_WIDTH, type: WidthType.DXA },
          columnWidths: [2000, 7360],
          rows: [
            featureRow("Role", "Permissions", true),
            featureRow("Owner", "Full control: all CRUD operations, invite/remove members, change roles, delete workspace"),
            featureRow("Admin", "Manage members (member/viewer roles), invite, set visibility, all content operations"),
            featureRow("Member", "Create, edit, and delete own content; view all workspace content"),
            featureRow("Viewer", "Read-only access to all workspace content"),
          ],
        }),
        spacer(),
        body("Team members are invited via email with role assignment. Invitation emails are sent through the custom found3ry.com domain with 7-day token expiry. A dedicated join page handles invitation acceptance."),
        spacer(),

        // 3.11 Command Palette
        heading("Command Palette", HeadingLevel.HEADING_2),
        body("The Command Palette (Cmd+K / Ctrl+K) provides keyboard-first navigation across the entire platform. Users can jump to any page, trigger actions, and search without leaving the keyboard. This enables power-user workflows for users who prefer keyboard-driven interfaces."),
        new Paragraph({ children: [new PageBreak()] }),

        // ─── 4. SECURITY & PRIVACY ──────────────────────────────────────
        heading("Security and Privacy"),
        body("The FOUND3RY implements production-grade security measures:"),
        spacer(),
        new Paragraph({ numbering: { reference: "bullets", level: 0 }, children: [new TextRun({ font: "Arial", size: 22, text: "JWT authentication with bcrypt password hashing and automatic token refresh" })] }),
        new Paragraph({ numbering: { reference: "bullets", level: 0 }, children: [new TextRun({ font: "Arial", size: 22, text: "Rate limiting on all auth endpoints (login: 10/min, register: 5/min, password reset: 3/min)" })] }),
        new Paragraph({ numbering: { reference: "bullets", level: 0 }, children: [new TextRun({ font: "Arial", size: 22, text: "Email verification with 24-hour token expiry" })] }),
        new Paragraph({ numbering: { reference: "bullets", level: 0 }, children: [new TextRun({ font: "Arial", size: 22, text: "Password reset with 1-hour token expiry and anti-enumeration protection" })] }),
        new Paragraph({ numbering: { reference: "bullets", level: 0 }, children: [new TextRun({ font: "Arial", size: 22, text: "CORS lockdown to specific allowed origins" })] }),
        new Paragraph({ numbering: { reference: "bullets", level: 0 }, children: [new TextRun({ font: "Arial", size: 22, text: "Security headers: HSTS, X-Frame-Options DENY, X-Content-Type-Options nosniff" })] }),
        new Paragraph({ numbering: { reference: "bullets", level: 0 }, children: [new TextRun({ font: "Arial", size: 22, text: "Request tracing with unique X-Request-ID on every API call" })] }),
        new Paragraph({ numbering: { reference: "bullets", level: 0 }, children: [new TextRun({ font: "Arial", size: 22, text: "GZip compression on all API responses" })] }),
        new Paragraph({ numbering: { reference: "bullets", level: 0 }, children: [new TextRun({ font: "Arial", size: 22, text: "Workspace-isolated data \u2014 users can only access data within their workspace" })] }),
        new Paragraph({ numbering: { reference: "bullets", level: 0 }, children: [new TextRun({ font: "Arial", size: 22, text: "Full data export as JSON for GDPR compliance" })] }),
        new Paragraph({ numbering: { reference: "bullets", level: 0 }, children: [new TextRun({ font: "Arial", size: 22, text: "Account deletion with complete data removal (right to be forgotten)" })] }),
        new Paragraph({ children: [new PageBreak()] }),

        // ─── 5. INFRASTRUCTURE ───────────────────────────────────────────
        heading("Infrastructure and Deployment"),
        body("The FOUND3RY is deployed on a modern cloud infrastructure optimized for performance and cost:"),
        spacer(),
        new Table({
          width: { size: CONTENT_WIDTH, type: WidthType.DXA },
          columnWidths: [2800, 6560],
          rows: [
            featureRow("Service", "Details", true),
            featureRow("Frontend", "Vercel \u2014 global CDN, auto-SSL, edge caching at found3ry.com"),
            featureRow("Backend API", "Railway \u2014 containerized FastAPI with auto-deploy from GitHub"),
            featureRow("Database", "Railway PostgreSQL with pgvector extension for vector similarity search"),
            featureRow("Cache", "Railway Redis for API response caching, session management, and real-time pubsub"),
            featureRow("Email", "Resend with verified found3ry.com domain (DKIM + SPF verified)"),
            featureRow("Monitoring", "Sentry for error tracking, structured logging with request tracing"),
            featureRow("CI/CD", "Auto-deploy on git push to main branch (both Vercel and Railway)"),
          ],
        }),
        spacer(),
        body("The entire stack is containerized via Docker with multi-stage builds for optimized image sizes. The production configuration includes resource limits, restart policies, and log rotation."),
        new Paragraph({ children: [new PageBreak()] }),

        // ─── 6. API REFERENCE ────────────────────────────────────────────
        heading("API Reference Summary"),
        body("The FOUND3RY exposes a comprehensive REST API with 15 route groups:"),
        spacer(),
        new Table({
          width: { size: CONTENT_WIDTH, type: WidthType.DXA },
          columnWidths: [2400, 6960],
          rows: [
            featureRow("Endpoint Group", "Operations", true),
            featureRow("/api/auth", "Register, login, refresh, verify email, forgot/reset password, profile, data export, account deletion"),
            featureRow("/api/projects", "CRUD, forge plan, export, related items"),
            featureRow("/api/tasks", "CRUD with filters, assignment, status updates"),
            featureRow("/api/knowledge", "CRUD, full-text search, semantic search, AI Q&A"),
            featureRow("/api/ideas", "CRUD, forge ideas, SWOT analysis generation"),
            featureRow("/api/copilot", "Chat with context-aware AI, conversation history"),
            featureRow("/api/agents", "Run specialized agents, pipeline orchestration"),
            featureRow("/api/analytics", "Velocity, project health, attention items"),
            featureRow("/api/workspace", "Members, invites, roles, visibility settings"),
            featureRow("/api/blueprint", "Canvas CRUD, real-time operations"),
            featureRow("/api/notifications", "List, mark read, delete"),
            featureRow("/api/context", "Insights, connections, activity timeline"),
            featureRow("/api/launchpad", "Launch brief generation (forge-brief)"),
            featureRow("/api/command", "Command palette parsing and history"),
            featureRow("/api/subscription", "Plan info, usage tracking"),
          ],
        }),
        spacer(),
        body("All endpoints require JWT authentication (except register, login, and forgot-password). Streaming endpoints use Server-Sent Events (SSE) for real-time AI output. WebSocket endpoints are available for blueprint canvas collaboration and notification delivery."),
        new Paragraph({ children: [new PageBreak()] }),

        // ─── 7. ROADMAP ─────────────────────────────────────────────────
        heading("Roadmap"),
        heading("Near-Term (Q2 2026)", HeadingLevel.HEADING_2),
        new Paragraph({ numbering: { reference: "bullets", level: 0 }, children: [new TextRun({ font: "Arial", size: 22, text: "Stripe integration for Pro and Team subscription plans" })] }),
        new Paragraph({ numbering: { reference: "bullets", level: 0 }, children: [new TextRun({ font: "Arial", size: 22, text: "Full team workspace collaboration with real-time cursors" })] }),
        new Paragraph({ numbering: { reference: "bullets", level: 0 }, children: [new TextRun({ font: "Arial", size: 22, text: "Mobile-responsive UI optimization" })] }),
        new Paragraph({ numbering: { reference: "bullets", level: 0 }, children: [new TextRun({ font: "Arial", size: 22, text: "Document export (DOCX, PDF) for project plans and briefs" })] }),
        spacer(),
        heading("Mid-Term (Q3 2026)", HeadingLevel.HEADING_2),
        new Paragraph({ numbering: { reference: "bullets", level: 0 }, children: [new TextRun({ font: "Arial", size: 22, text: "Custom AI agent creation \u2014 users define their own specialized agents" })] }),
        new Paragraph({ numbering: { reference: "bullets", level: 0 }, children: [new TextRun({ font: "Arial", size: 22, text: "Integration marketplace (Slack, GitHub, Notion import)" })] }),
        new Paragraph({ numbering: { reference: "bullets", level: 0 }, children: [new TextRun({ font: "Arial", size: 22, text: "Advanced analytics with trend visualization" })] }),
        new Paragraph({ numbering: { reference: "bullets", level: 0 }, children: [new TextRun({ font: "Arial", size: 22, text: "API access for power users and automation" })] }),
        spacer(),
        heading("Long-Term (Q4 2026+)", HeadingLevel.HEADING_2),
        new Paragraph({ numbering: { reference: "bullets", level: 0 }, children: [new TextRun({ font: "Arial", size: 22, text: "Enterprise SSO (SAML/OIDC) and audit logging" })] }),
        new Paragraph({ numbering: { reference: "bullets", level: 0 }, children: [new TextRun({ font: "Arial", size: 22, text: "White-label and self-hosted deployment options" })] }),
        new Paragraph({ numbering: { reference: "bullets", level: 0 }, children: [new TextRun({ font: "Arial", size: 22, text: "Marketplace for community-built agents and templates" })] }),
        new Paragraph({ numbering: { reference: "bullets", level: 0 }, children: [new TextRun({ font: "Arial", size: 22, text: "Multi-workspace management for portfolio builders" })] }),
        new Paragraph({ children: [new PageBreak()] }),

        // ─── 8. CONTACT ─────────────────────────────────────────────────
        heading("Get Started"),
        spacer(),
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { after: 200 },
          children: [
            new TextRun({ text: "The FOUND3RY is free during early access.", font: "Arial", size: 24, color: DARK }),
          ],
        }),
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { after: 100 },
          children: [
            new TextRun({ text: "No limits. No credit card required.", font: "Arial", size: 24, color: DARK }),
          ],
        }),
        spacer(),
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { after: 200 },
          children: [
            new ExternalHyperlink({
              children: [new TextRun({ text: "found3ry.com", style: "Hyperlink", font: "Arial", size: 28, bold: true })],
              link: "https://found3ry.com",
            }),
          ],
        }),
        spacer(),
        new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [
            new TextRun({ text: "Built by ", font: "Arial", size: 22, color: GRAY }),
            new TextRun({ text: "h", font: "Arial", size: 22, bold: true, color: "2563EB" }),
            new TextRun({ text: "3", font: "Arial", size: 22, bold: true, color: "F97316" }),
            new TextRun({ text: "ros", font: "Arial", size: 22, bold: true, color: "2563EB" }),
          ],
        }),
      ],
    },
  ],
});

// Generate the document
Packer.toBuffer(doc).then(buffer => {
  const outPath = "/Users/shauryakarra/The FOUNDRY/docs/The-FOUND3RY-V1-Product-Overview.docx";
  fs.writeFileSync(outPath, buffer);
  console.log("Document created: " + outPath);
});
