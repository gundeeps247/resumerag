# Behavioural Interview Notes — Raw Stories

_Rough personal notes by Alex Rivera (fictional demo data). Not polished answers._

## Story 1 — Disagreement about the churn label (Finlytics, 2025)

In the second month of my internship, the product manager wanted to define churn as "no login for 30 days". I thought this was wrong because many healthy customers only log in when their salary arrives. I pulled 6 months of data and showed that a 30-day definition would label 22% of active, paying customers as churned. I proposed "account closed OR no transactions for 60 days" instead. We reviewed the analysis with the data science lead in a 30-minute meeting and the team adopted the 60-day definition. I learned to bring data to a disagreement instead of opinions.

## Story 2 — Catching data leakage before launch (Finlytics, 2025)

My first XGBoost model reached an AUC of 0.97, which looked too good to be true. I did a feature audit and found that the feature "account_status_updated_at" was only filled in after a customer had already churned — it leaked the label. I removed it, switched to a strict time-based train/validation/test split, and the honest AUC dropped to 0.89. I told my manager immediately, even though the lower number was disappointing. This became a checklist item for the team: every feature needs a timestamp that proves it is available at prediction time.

## Story 3 — Leading the Campus Marketplace team (2023)

I led a team of four students building a buy/sell marketplace for our campus. Halfway through, two teammates wanted to rewrite the backend from Express to Django, which would have cost us two weeks before the semester demo. I set up a short meeting where each side listed risks, and we agreed to keep Express but move the most painful part (search) to PostgreSQL full-text search. We shipped on time and the app reached 1,200 registered students. In hindsight I should have written a short design document at the start so the stack decision was made together.

## Story 4 — Hackathon under pressure (HackNorth 2024)

At HackNorth 2024 our speech-to-text API stopped working 10 hours before the deadline because we hit a rate limit. I switched us to an open-source Whisper model running locally, re-scoped the demo to the three most important features, and we won "Best Use of AI". Lesson: always have a fallback for external dependencies.

## Weaknesses I should be honest about

- I have only used Kubernetes in a tutorial; I have never deployed a production service on it.
- I have not used MLflow; at Finlytics experiments were tracked in spreadsheets and Git tags.
- My AWS experience is limited to EC2 and S3 for personal projects.
