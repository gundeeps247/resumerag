/**
 * Generates the binary demo documents (resume PDF and project report DOCX) for the
 * fictional persona "Alex Rivera". The Markdown/TXT demo files live directly in
 * public/demo. Run with: npm run demo:generate
 *
 * The resume intentionally contains a few claims that interviewers would challenge
 * (vague verbs, missing metrics, an "expert" claim) and two numbers that disagree with
 * the project report (AUC 0.91 vs 0.89; churn reduced 18% vs 11%), so the Weakness
 * Detector and Consistency Checker have something real to find.
 */
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { AlignmentType, Document, HeadingLevel, Packer, Paragraph, Table, TableCell, TableRow, TextRun, WidthType } from "docx";
import { PDFDocument, rgb, StandardFonts, type PDFFont, type PDFPage } from "pdf-lib";

const OUT_DIR = path.join(process.cwd(), "public", "demo");

// ---------------------------------------------------------------------------
// Resume (PDF)
// ---------------------------------------------------------------------------

type ResumeItem =
  | { kind: "section"; text: string }
  | { kind: "title"; text: string }
  | { kind: "meta"; text: string }
  | { kind: "bullet"; text: string }
  | { kind: "text"; text: string };

const RESUME: ResumeItem[] = [
  { kind: "section", text: "SUMMARY" },
  {
    kind: "text",
    text: "Machine learning engineer with hands-on experience building and deploying predictive models and search systems. Passionate about turning data into products. Expert in machine learning and deep learning.",
  },
  { kind: "section", text: "EDUCATION" },
  { kind: "title", text: "B.Tech in Computer Science and Engineering - Northfield Institute of Technology" },
  { kind: "meta", text: "2021 - 2025  |  CGPA: 8.7/10" },
  {
    kind: "text",
    text: "Relevant coursework: Machine Learning, Data Structures and Algorithms, Database Systems, Distributed Systems, Information Retrieval.",
  },
  { kind: "section", text: "EXPERIENCE" },
  { kind: "title", text: "Machine Learning Intern - Finlytics" },
  { kind: "meta", text: "Jan 2025 - Jun 2025  |  Fintech startup, Bengaluru" },
  { kind: "bullet", text: "Built a customer churn prediction system using XGBoost that achieved an AUC of 0.91 on the holdout set." },
  {
    kind: "bullet",
    text: "Engineered 40+ behavioural features from 14 months of transaction and support-ticket data for 120,000 customers.",
  },
  {
    kind: "bullet",
    text: "Deployed the model as a weekly batch-scoring pipeline with Airflow and a FastAPI endpoint used by the retention team.",
  },
  { kind: "bullet", text: "Helped reduce customer churn by 18% through targeted retention campaigns." },
  { kind: "bullet", text: "Used SHAP to explain model predictions to non-technical stakeholders." },
  { kind: "title", text: "Software Engineering Intern - CartWave" },
  { kind: "meta", text: "May 2024 - Jul 2024  |  E-commerce platform" },
  { kind: "bullet", text: "Developed REST APIs in Python (FastAPI) for the order-tracking service handling 2M+ requests per day." },
  { kind: "bullet", text: "Introduced Redis caching for product lookups, reducing p95 latency by 40%." },
  { kind: "bullet", text: "Worked on various backend improvements and bug fixes." },
  { kind: "bullet", text: "Wrote unit and integration tests with pytest, raising test coverage from 52% to 81%." },
  { kind: "section", text: "PROJECTS" },
  { kind: "title", text: "LexiSearch - Semantic Search for Legal Documents" },
  { kind: "meta", text: "Python, sentence-transformers, FAISS, FastAPI, React" },
  { kind: "bullet", text: "Built a semantic search engine over 25,000 court judgments using sentence embeddings and a FAISS index." },
  { kind: "bullet", text: "Achieved MRR@10 of 0.72 versus 0.51 for a BM25 baseline, with p95 query latency of 120 ms." },
  { kind: "bullet", text: "Implemented chunking, metadata filters and a React UI with highlighted passages." },
  { kind: "title", text: "PulseCheck - Real-time Anomaly Detection for IoT Sensors" },
  { kind: "meta", text: "PyTorch, Kafka, Docker" },
  { kind: "bullet", text: "Trained an LSTM autoencoder to flag anomalies in streaming temperature and vibration data." },
  { kind: "bullet", text: "Processed 5,000 events per second through Kafka with sub-second alerting." },
  { kind: "bullet", text: "Designed a scalable, fault-tolerant architecture." },
  { kind: "title", text: "Campus Marketplace - Full-stack Web App" },
  { kind: "meta", text: "Next.js, TypeScript, PostgreSQL, Prisma" },
  { kind: "bullet", text: "Led a team of 4 to build a buy/sell marketplace used by 1,200+ students." },
  { kind: "bullet", text: "Implemented authentication, listing search and an admin moderation dashboard." },
  { kind: "section", text: "SKILLS" },
  { kind: "text", text: "Languages: Python, TypeScript, JavaScript, SQL, Java" },
  {
    kind: "text",
    text: "ML / AI: PyTorch, scikit-learn, XGBoost, pandas, NumPy, SHAP, sentence-transformers, FAISS, Hugging Face Transformers",
  },
  { kind: "text", text: "Backend and data: FastAPI, Node.js, PostgreSQL, Redis, Kafka, Airflow" },
  { kind: "text", text: "Cloud and DevOps: Docker, AWS (EC2, S3), GitHub Actions, familiar with Kubernetes" },
  { kind: "section", text: "ACHIEVEMENTS" },
  {
    kind: "bullet",
    text: "Winner, HackNorth 2024 (Best Use of AI) - built an accessibility assistant for visually impaired users in 36 hours.",
  },
  { kind: "bullet", text: 'Co-author, "Hybrid Retrieval for Low-Resource Legal Search", Student Research Symposium 2024.' },
  { kind: "bullet", text: 'Top 5% in the Kaggle "Tabular Playground" competition.' },
];

class PdfWriter {
  page!: PDFPage;
  y = 0;
  readonly margin = 54;
  readonly width = 612;
  readonly height = 792;

  constructor(
    private readonly doc: PDFDocument,
    private readonly fonts: { regular: PDFFont; bold: PDFFont; italic: PDFFont },
  ) {
    this.newPage();
  }

  newPage() {
    this.page = this.doc.addPage([this.width, this.height]);
    this.y = this.height - this.margin;
  }

  wrap(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
    const words = text.split(/\s+/);
    const lines: string[] = [];
    let line = "";
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(candidate, size) > maxWidth && line) {
        lines.push(line);
        line = word;
      } else {
        line = candidate;
      }
    }
    if (line) lines.push(line);
    return lines;
  }

  write(text: string, opts: { font: PDFFont; size: number; indent?: number; gapBefore?: number; color?: number; bullet?: boolean }) {
    const indent = opts.indent ?? 0;
    const lineHeight = opts.size * 1.32;
    const lines = this.wrap(text, opts.font, opts.size, this.width - this.margin * 2 - indent);
    this.y -= opts.gapBefore ?? 0;
    if (this.y - lineHeight * lines.length < this.margin) this.newPage();
    lines.forEach((line, i) => {
      this.y -= lineHeight;
      if (opts.bullet && i === 0) {
        this.page.drawText("•", { x: this.margin + indent - 9, y: this.y, size: opts.size, font: this.fonts.regular });
      }
      const shade = opts.color ?? 0.1;
      this.page.drawText(line, { x: this.margin + indent, y: this.y, size: opts.size, font: opts.font, color: rgb(shade, shade, shade) });
    });
  }

  rule() {
    this.y -= 4;
    this.page.drawLine({
      start: { x: this.margin, y: this.y },
      end: { x: this.width - this.margin, y: this.y },
      thickness: 0.6,
      color: rgb(0.75, 0.75, 0.75),
    });
  }
}

async function buildResumePdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle("Alex Rivera - Resume (fictional demo)");
  doc.setAuthor("ResumeRAG demo data");
  const fonts = {
    regular: await doc.embedFont(StandardFonts.Helvetica),
    bold: await doc.embedFont(StandardFonts.HelveticaBold),
    italic: await doc.embedFont(StandardFonts.HelveticaOblique),
  };
  const w = new PdfWriter(doc, fonts);

  w.write("Alex Rivera", { font: fonts.bold, size: 22 });
  w.write(
    "Machine Learning Engineer  |  alex.rivera@example.com  |  +1 555 010 2233  |  github.com/alex-rivera-demo  |  linkedin.com/in/alex-rivera-demo",
    { font: fonts.regular, size: 8.5, gapBefore: 4, color: 0.35 },
  );

  for (const item of RESUME) {
    switch (item.kind) {
      case "section":
        w.write(item.text, { font: fonts.bold, size: 12.5, gapBefore: 14 });
        w.rule();
        break;
      case "title":
        w.write(item.text, { font: fonts.bold, size: 11, gapBefore: 8 });
        break;
      case "meta":
        w.write(item.text, { font: fonts.italic, size: 9.5, color: 0.4 });
        break;
      case "bullet":
        w.write(item.text, { font: fonts.regular, size: 9.5, indent: 12, gapBefore: 2, bullet: true });
        break;
      case "text":
        w.write(item.text, { font: fonts.regular, size: 9.5, gapBefore: 3 });
        break;
    }
  }
  return doc.save();
}

// ---------------------------------------------------------------------------
// Project report (DOCX)
// ---------------------------------------------------------------------------

const h1 = (text: string) => new Paragraph({ text, heading: HeadingLevel.HEADING_1, spacing: { before: 280, after: 120 } });
const p = (text: string) => new Paragraph({ children: [new TextRun(text)], spacing: { after: 120 } });
const bullet = (text: string) => new Paragraph({ text, bullet: { level: 0 } });

function table(rows: string[][]): Table {
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: rows.map(
      (cells, r) =>
        new TableRow({
          children: cells.map(
            (cell) =>
              new TableCell({
                children: [new Paragraph({ children: [new TextRun({ text: cell, bold: r === 0 })] })],
              }),
          ),
        }),
    ),
  });
}

async function buildReportDocx(): Promise<Buffer> {
  const doc = new Document({
    creator: "ResumeRAG demo data",
    title: "Customer Churn Prediction - Internship Project Report",
    sections: [
      {
        children: [
          new Paragraph({ text: "Customer Churn Prediction at Finlytics", heading: HeadingLevel.TITLE }),
          new Paragraph({
            alignment: AlignmentType.LEFT,
            children: [
              new TextRun({
                text: "Internship project report  |  Alex Rivera, Machine Learning Intern  |  January - June 2025  |  Fictional demo document",
                italics: true,
              }),
            ],
            spacing: { after: 240 },
          }),

          h1("1. Executive Summary"),
          p(
            "Finlytics wanted to identify customers who are likely to close their accounts so the retention team could contact them before they leave. I built a churn prediction model that ranks customers by their risk of churning in the next 60 days. The final XGBoost model achieved a ROC-AUC of 0.89 on a time-based holdout set, compared with 0.78 for a logistic regression baseline.",
          ),
          p(
            "A pilot retention campaign, designed and run by the marketing team, targeted the 10% highest-risk customers. Churn in the pilot group was 11% lower than in a randomly selected control group over two months.",
          ),

          h1("2. Problem Statement"),
          p(
            "Monthly churn at Finlytics was around 3.2%. Before this project the retention team contacted customers at random or only after they complained, which wasted effort on customers who were never going to leave. The goal was a weekly ranked list of customers by churn risk, with an explanation of why each customer is at risk.",
          ),

          h1("3. Data"),
          p(
            "The dataset covered 120,000 customers over 14 months and combined three sources: card and bank transactions, mobile app events, and support tickets. A customer was labelled as churned if they closed their account or had no transactions for 60 days. Only about 7% of customers churned in a given window, so the classes were heavily imbalanced (roughly 1 positive for every 14 negatives).",
          ),

          h1("4. Feature Engineering"),
          p("I engineered 43 features computed over 7-, 30- and 90-day windows. The most useful groups were:"),
          bullet("Recency, frequency and monetary value of transactions."),
          bullet("Trend in account balance and in salary credits."),
          bullet("Number of failed payments and declined card transactions."),
          bullet("Support tickets in the last 30 days, especially tickets tagged as fee complaints."),
          bullet("Decay in mobile app login frequency."),

          h1("5. Modelling Approach"),
          p(
            "I compared logistic regression, random forest and XGBoost. Hyperparameters were tuned with Optuna over 100 trials. To handle class imbalance I used XGBoost's scale_pos_weight parameter. I also tried SMOTE oversampling, but it made the predicted probabilities poorly calibrated and did not improve PR-AUC, so I dropped it.",
          ),
          p(
            "I used a strict time-based split: training on January to October, validation on November, and testing on December to February. A random split would have leaked future information into training.",
          ),

          h1("6. Results"),
          table([
            ["Model", "ROC-AUC", "PR-AUC", "Recall at top 10%"],
            ["Logistic regression (baseline)", "0.78", "0.31", "0.42"],
            ["Random forest", "0.85", "0.44", "0.55"],
            ["XGBoost (final)", "0.89", "0.52", "0.63"],
          ]),
          p(
            "Because the retention team can only contact about 10% of customers each week, recall in the top 10% was the metric the business cared about most. XGBoost caught 63% of churners while contacting only 10% of customers.",
          ),

          h1("7. Explainability"),
          p(
            "I used SHAP values to explain individual predictions. The strongest churn drivers were declining app logins, failed payments and recent fee complaints. A short SHAP summary was attached to every customer in the weekly list, which helped the retention team trust the model and personalise their calls.",
          ),

          h1("8. Deployment and Monitoring"),
          p(
            "The model runs as a weekly batch-scoring job orchestrated with Airflow. Scores are written to PostgreSQL and exposed to the CRM through a small FastAPI endpoint. The data engineering team owned the Airflow infrastructure; I wrote the scoring tasks. I added monitoring with the population stability index (PSI) on the ten most important features to detect data drift.",
          ),

          h1("9. Challenges and Lessons Learned"),
          p(
            "Data leakage: my first model reached an AUC of 0.97, which was too good to be true. A feature audit showed that account_status_updated_at was only populated after a customer had churned, so it leaked the label. After removing it and using the time-based split, the honest AUC was 0.89.",
          ),
          p(
            "Label definition: the product team first proposed defining churn as 30 days without a login. Analysis showed that this would mislabel about 22% of active, paying customers, so we agreed on the 60-day, no-transaction definition.",
          ),

          h1("10. My Contribution"),
          p(
            "I owned feature engineering, model training, hyperparameter tuning and the evaluation framework, and I wrote the Airflow scoring tasks and the SHAP explanations. The data engineering team built the pipeline infrastructure, and the retention campaign itself was designed and executed by the marketing team.",
          ),

          h1("11. Future Work"),
          bullet("Move from weekly batch scoring to near real-time scoring on transaction events."),
          bullet("Use uplift modelling to target customers who are persuadable, not just at risk."),
          bullet("Set up a proper A/B testing framework to measure the causal effect of retention offers."),
          bullet("Track experiments and model versions in MLflow instead of spreadsheets."),
        ],
      },
    ],
  });
  return Packer.toBuffer(doc);
}

async function main() {
  const resume = await buildResumePdf();
  await writeFile(path.join(OUT_DIR, "alex-rivera-resume.pdf"), resume);
  const report = await buildReportDocx();
  await writeFile(path.join(OUT_DIR, "finlytics-churn-project-report.docx"), report);
  console.log(`Demo documents written to ${OUT_DIR}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
