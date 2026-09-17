# Northwind Analytics — Company Research Notes

_Fictional company created for the ResumeRAG demo._

## About the company

Northwind Analytics was founded in 2016 and is headquartered in Bengaluru, with around 350 employees. Its mission is "helping retailers make every inventory and customer decision with confidence." The company raised a Series C round in 2024.

## Products

- **Northwind Forecast** — demand forecasting for retail chains, built on gradient-boosted trees (LightGBM) and a hierarchical reconciliation layer.
- **Northwind Signal** — customer analytics: churn risk, customer lifetime value and next-best-offer recommendations.
- **Analyst Assistant** — a new LLM assistant that answers questions about a customer's dashboards using retrieval-augmented generation.

## Engineering culture

The engineering blog describes a migration of their feature store to Feast, weekly model retraining orchestrated with Airflow, and model tracking in MLflow. Engineers are expected to own models end-to-end, including monitoring for data drift.

## Interview process (from Glassdoor-style reports)

1. Recruiter screen (30 minutes): motivation, background, logistics.
2. Technical screen: ML fundamentals (bias–variance, metrics for imbalanced data, regularisation) plus a SQL exercise.
3. Project deep dive: candidates present one project for 20 minutes and answer detailed follow-up questions about design decisions, evaluation and what they personally built.
4. ML system design (lite): design a churn-prediction or forecasting system end-to-end.
5. Behavioural round: ownership, handling ambiguity, disagreements with teammates.

## Values

Customer obsession, "measure before you optimise", and writing things down.
