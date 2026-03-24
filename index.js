const nodemailer = require("nodemailer");
const Anthropic = require("@anthropic-ai/sdk");

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const OLIVER_PROFILE = `
Name: Oliver Chapman
Current Role: Customer Success Manager at Streem (media monitoring/analytics)
Background: Bachelor of IT and Commerce, ANU (2021-2025), 70 WAM

Work Experience:
- Streem (Dec 2025 - Present): CSM. Government media monitoring clients, boolean query development, whole-of-government onboarding, automated reporting workflows.
- KINSHIP Digital (Sep 2024 - Nov 2025): Senior Professional Services Consultant. Delivered AI-powered CX platform (Sprinklr) for public sector. Configured dashboards, AI workflows, LLM summaries, sentiment analysis. Won $300K ARR client via demo. 100% client retention. Led GovSocial Benchmarks across 30+ agencies.
- Deloitte (Nov-Dec 2023): Summer Vacationer - Data & AI. Public sector data migration.
- ANU Payroll (Apr-Aug 2024): Built Power Automate automation reducing workload 20%.

Technical: Python, Java, SQL, Power Automate, Sprinklr, Claude API, Node.js
Certifications: Anthropic Academy AI Fluency, Claude 101, Claude Code
Building: Boolean-to-plain-English tool via Claude API + Slack

Target: AI consulting, strategy consulting (TMT), customer success (AI-focused), professional services
Location: Sydney, Australia
`;

const SEARCH_QUERIES = [
  "AI consulting analyst",
  "customer success manager AI SaaS",
  "professional services consultant technology",
  "data AI graduate program",
];

async function searchIndeedJobs(query) {
  console.log(`Searching for: "${query}"...`);
  const response = await client.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 1000,
    messages: [
      {
        role: "user",
        content: `Search for "${query}" jobs in Sydney Australia posted in the last 7 days on Seek, Indeed or LinkedIn. Return a plain text list of results including: job title, company, location, salary if listed, and the URL. List as many as you can find.`,
      },
    ],
    tools: [{ type: "web_search_20250305", name: "web_search" }],
  });

  return response.content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("\n");
}

async function rankAndFormatJobs(allJobsRaw) {
  console.log("Ranking jobs against profile...");
  const response = await client.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 1000,
    system: `You are a career advisor. Return ONLY valid JSON, no markdown, no backticks. Candidate profile:\n${OLIVER_PROFILE}`,
    messages: [
      {
        role: "user",
        content: `Here are job listings:\n\n${allJobsRaw}\n\nScore each job 1-10 for fit. Return a JSON array of the top 8 jobs with fields: title, company, location, salary (or "Not specified"), matchScore (1-10), matchReasons (array of 2 short strings), applyUrl (if available, else "#"), summary (1 sentence). Sort by matchScore descending. Only include roles scoring 5 or above.`,
      },
    ],
  });

  const raw = response.content.find((b) => b.type === "text")?.text || "[]";
  try {
    const clean = raw.replace(/```json|```/g, "").trim();
    const start = clean.indexOf("[");
    const end = clean.lastIndexOf("]");
    return JSON.parse(clean.slice(start, end + 1));
  } catch (e) {
    console.error("Failed to parse job rankings:", e.message);
    return [];
  }
}

function scoreColor(score) {
  if (score >= 8) return "#22c55e";
  if (score >= 6) return "#f59e0b";
  return "#ef4444";
}

function buildEmailHtml(jobs, date) {
  const jobCards = jobs.map((job) => `
    <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:18px 20px;margin-bottom:12px;">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:8px;">
        <div>
          <div style="font-size:16px;font-weight:600;color:#0f172a;margin-bottom:2px;">${job.title}</div>
          <div style="font-size:13px;color:#64748b;">${job.company} &nbsp;·&nbsp; ${job.location} &nbsp;·&nbsp; ${job.salary}</div>
        </div>
        <div style="background:${scoreColor(job.matchScore)};color:#fff;font-weight:700;font-size:14px;border-radius:6px;padding:4px 10px;white-space:nowrap;margin-left:12px;">
          ${job.matchScore}/10
        </div>
      </div>
      <div style="font-size:13px;color:#475569;margin-bottom:10px;line-height:1.5;">${job.summary}</div>
      <div style="margin-bottom:12px;">
        ${job.matchReasons.map((r) => `<span style="display:inline-block;font-size:11px;background:#e0e7ff;color:#4338ca;border-radius:20px;padding:2px 10px;margin-right:6px;margin-bottom:4px;">${r}</span>`).join("")}
      </div>
      <a href="${job.applyUrl}" style="display:inline-block;background:#6366f1;color:#fff;font-size:13px;font-weight:500;padding:8px 16px;border-radius:7px;text-decoration:none;">
        View role
      </a>
    </div>
  `).join("");

  return `
<!DOCTYPE html>
<html>
<body style="margin:0;padding:0;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;background:#f1f5f9;">
  <div style="max-width:600px;margin:32px auto;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.1);">
    <div style="background:#0f172a;padding:28px 32px;">
      <div style="font-size:11px;color:#6366f1;font-weight:600;letter-spacing:1.5px;text-transform:uppercase;margin-bottom:6px;">Job Search Agent</div>
      <div style="font-size:22px;font-weight:700;color:#f8fafc;">Today's digest</div>
      <div style="font-size:13px;color:#475569;margin-top:4px;">${date} &nbsp;·&nbsp; ${jobs.length} roles ranked by fit</div>
    </div>
    <div style="padding:24px 32px;">${jobCards}</div>
    <div style="padding:16px 32px 24px;border-top:1px solid #e2e8f0;">
      <div style="font-size:11px;color:#94a3b8;">
        Generated by your job search agent &nbsp;·&nbsp; Web search + Claude API &nbsp;·&nbsp; Oliver Chapman 2026
      </div>
    </div>
  </div>
</body>
</html>`;
}

async function sendEmail(html, jobCount) {
  console.log("Sending email...");
  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: "ochapman26@gmail.com",
      pass: process.env.GMAIL_APP_PASSWORD,
    },
  });

  await transporter.sendMail({
    from: '"Job Agent" <ochapman26@gmail.com>',
    to: "ochapman26@gmail.com",
    subject: `Job digest: ${jobCount} new roles — ${new Date().toLocaleDateString("en-AU", { weekday: "long", day: "numeric", month: "short" })}`,
    html,
  });

  console.log("Email sent successfully.");
}

async function main() {
  console.log("Job agent starting...");

  const rawResults = [];
  for (const query of SEARCH_QUERIES) {
    const result = await searchIndeedJobs(query);
    rawResults.push(result);
    await new Promise((r) => setTimeout(r, 1500));
  }

  const combined = rawResults.filter(Boolean).join("\n\n---\n\n");

  if (!combined.trim()) {
    console.log("No job data retrieved. Exiting.");
    process.exit(0);
  }

  const jobs = await rankAndFormatJobs(combined);

  if (!jobs.length) {
    console.log("No jobs ranked. Exiting.");
    process.exit(0);
  }

  console.log(`Found ${jobs.length} ranked jobs.`);

  const date = new Date().toLocaleDateString("en-AU", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });

  const html = buildEmailHtml(jobs, date);
  await sendEmail(html, jobs.length);

  console.log("Done.");
}

main().catch((err) => {
  console.error("Agent failed:", err);
  process.exit(1);
});
