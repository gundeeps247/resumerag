/**
 * Skills taxonomy: a transparent dictionary of common technical skills with the
 * patterns used to find them in text. Deterministic extraction is fast, explainable and
 * never hallucinates a skill — a skill is "found" only if its name literally appears.
 */

export type SkillCategory = "Languages" | "ML & AI" | "Data" | "Backend & web" | "Cloud & DevOps" | "Practices";

export interface SkillDef {
  name: string;
  category: SkillCategory;
  pattern: RegExp;
}

// Boundaries that treat "+", "#", "." as part of a token (C++, C#, Node.js).
const B = "(?<![\\w+#.])";
const E = "(?![\\w+#])";

function skill(name: string, category: SkillCategory, ...aliases: string[]): SkillDef {
  const alts = [name, ...aliases].map((a) =>
    a
      .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
      .replace(/\\ /g, "\\s+")
      .replace(/ /g, "[\\s-]?"),
  );
  return { name, category, pattern: new RegExp(`${B}(?:${alts.join("|")})${E}`, "i") };
}

export const SKILLS: SkillDef[] = [
  // Languages
  skill("Python", "Languages"),
  skill("Java", "Languages"),
  skill("JavaScript", "Languages"),
  skill("TypeScript", "Languages"),
  skill("C++", "Languages", "cpp"),
  skill("C#", "Languages"),
  { name: "Go", category: "Languages", pattern: /\bGolang\b|(?<![\w.])Go(?=\s*[,/)]|\s+(?:programming|language))/ },
  skill("Rust", "Languages"),
  skill("Kotlin", "Languages"),
  skill("Swift", "Languages"),
  skill("Scala", "Languages"),
  { name: "R", category: "Languages", pattern: /(?<![\w.+#])R(?=\s*[,/)]|\s+(?:programming|language|studio))/ },
  skill("SQL", "Languages"),
  skill("Bash", "Languages", "shell scripting"),
  // ML & AI
  skill("Machine learning", "ML & AI"),
  skill("Deep learning", "ML & AI"),
  skill("PyTorch", "ML & AI"),
  skill("TensorFlow", "ML & AI"),
  skill("Keras", "ML & AI"),
  skill("scikit-learn", "ML & AI", "sklearn", "scikit learn"),
  skill("XGBoost", "ML & AI"),
  skill("LightGBM", "ML & AI"),
  skill("pandas", "ML & AI"),
  skill("NumPy", "ML & AI"),
  skill("SHAP", "ML & AI"),
  skill("Hugging Face", "ML & AI", "HuggingFace"),
  skill("Transformers", "ML & AI"),
  skill("sentence-transformers", "ML & AI"),
  skill("LLM", "ML & AI", "LLMs", "large language model", "large language models"),
  skill("RAG", "ML & AI", "retrieval-augmented generation", "retrieval augmented generation"),
  skill("NLP", "ML & AI", "natural language processing"),
  skill("Computer vision", "ML & AI", "OpenCV"),
  skill("LangChain", "ML & AI"),
  skill("LlamaIndex", "ML & AI"),
  skill("FAISS", "ML & AI"),
  skill("Embeddings", "ML & AI", "sentence embeddings", "embedding model", "vector embeddings"),
  skill("Semantic search", "ML & AI", "vector search"),
  skill("LSTM", "ML & AI"),
  skill("Time-series forecasting", "ML & AI", "time series forecasting", "demand forecasting", "forecasting"),
  skill("Anomaly detection", "ML & AI"),
  skill("Recommendation systems", "ML & AI", "recommender systems", "recommendation system"),
  skill("A/B testing", "ML & AI", "A/B tests", "AB testing", "experimentation"),
  skill("MLflow", "ML & AI"),
  skill("Kubeflow", "ML & AI"),
  skill("Optuna", "ML & AI"),
  skill("MLOps", "ML & AI"),
  skill("Statistics", "ML & AI", "statistical"),
  // Data
  skill("PostgreSQL", "Data", "Postgres"),
  skill("MySQL", "Data"),
  skill("MongoDB", "Data"),
  skill("Redis", "Data"),
  skill("Kafka", "Data", "Apache Kafka"),
  skill("Spark", "Data", "Apache Spark", "PySpark"),
  skill("Airflow", "Data", "Apache Airflow"),
  skill("dbt", "Data"),
  skill("Snowflake", "Data"),
  skill("BigQuery", "Data"),
  skill("Elasticsearch", "Data"),
  skill("ETL", "Data", "data pipelines", "data pipeline"),
  skill("Tableau", "Data"),
  skill("Power BI", "Data"),
  // Backend & web
  skill("FastAPI", "Backend & web"),
  skill("Flask", "Backend & web"),
  skill("Django", "Backend & web"),
  skill("Node.js", "Backend & web", "NodeJS"),
  skill("Express", "Backend & web", "Express.js"),
  skill("Spring Boot", "Backend & web"),
  skill("REST APIs", "Backend & web", "REST API", "RESTful", "REST"),
  skill("GraphQL", "Backend & web"),
  skill("gRPC", "Backend & web"),
  skill("Microservices", "Backend & web"),
  skill("React", "Backend & web"),
  skill("Next.js", "Backend & web", "NextJS"),
  skill("Vue", "Backend & web", "Vue.js"),
  skill("Angular", "Backend & web"),
  skill("Prisma", "Backend & web"),
  // Cloud & DevOps
  skill("AWS", "Cloud & DevOps", "Amazon Web Services", "EC2", "S3", "Lambda", "SageMaker"),
  skill("GCP", "Cloud & DevOps", "Google Cloud"),
  skill("Azure", "Cloud & DevOps"),
  skill("Docker", "Cloud & DevOps", "containerization"),
  skill("Kubernetes", "Cloud & DevOps", "k8s"),
  skill("Terraform", "Cloud & DevOps"),
  skill("CI/CD", "Cloud & DevOps", "continuous integration"),
  skill("GitHub Actions", "Cloud & DevOps"),
  skill("Linux", "Cloud & DevOps"),
  skill("Git", "Cloud & DevOps"),
  // Practices & education
  skill("Computer science", "Practices", "computer engineering"),
  skill("Unit testing", "Practices", "pytest", "integration tests", "unit tests", "Jest"),
  skill("System design", "Practices"),
  skill("Agile", "Practices", "Scrum"),
  skill("Communication", "Practices", "stakeholders", "stakeholder communication"),
];

export interface SkillHit {
  name: string;
  category: SkillCategory;
  count: number;
}

export function extractSkills(text: string): SkillHit[] {
  const hits: SkillHit[] = [];
  for (const def of SKILLS) {
    const global = new RegExp(def.pattern.source, def.pattern.flags.includes("g") ? def.pattern.flags : `${def.pattern.flags}g`);
    const count = text.match(global)?.length ?? 0;
    if (count) hits.push({ name: def.name, category: def.category, count });
  }
  return hits;
}

export function hasSkill(text: string, name: string): boolean {
  const def = SKILLS.find((s) => s.name === name);
  return def ? def.pattern.test(text) : false;
}
