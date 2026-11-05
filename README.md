# LancerSnap

### AI-Assisted Campus Reporting & Issue Management Platform

LancerSnap is an AI-assisted campus reporting platform designed for **California Baptist University (CBU)**. It enables students to report physical and operational campus issues by simply taking a picture, adding a location, and submitting a report.

The system analyzes submissions, suggests issue categories and priorities, identifies potential duplicate reports, and routes reports to the appropriate CBU team.

---

## 1. The Problem

Students encounter problems across campus but may not always know whether to contact Housing, Facilities, Dining, IT, or building administration.

Although CBU already has personnel responsible for these areas, reporting channels can be fragmented, making it difficult for students to identify the right person to contact.

**LancerSnap provides one centralized reporting experience.**

## 2. Core Workflow

The reporting process is designed to be simple:

1. **Capture:** A student takes or uploads a photograph.
2. **Locate:** The student adds or confirms the campus location.
3. **Analyze:** AI suggests the issue category and priority.
4. **Review:** The student confirms or corrects the suggested information.
5. **Detect:** The system checks for potential duplicate reports.
6. **Route:** The report is directed to the appropriate CBU team.
7. **Resolve:** Staff investigate and address the issue.
8. **Track:** The student receives updates and can monitor resolution.

## 3. Key Features

| Feature                 | Description                                                    |
| ----------------------- | -------------------------------------------------------------- |
| Photo-Based Reporting   | Capture or upload an image of a campus issue.                  |
| Location Identification | Select or confirm the relevant campus building or area.        |
| AI Classification       | Identify the likely issue category and extract useful details. |
| Priority Suggestions    | Recommend the urgency of reported issues.                      |
| Duplicate Detection     | Identify similar reports to reduce duplicate work.             |
| Smart Routing           | Direct reports to the appropriate CBU team.                    |
| Report Tracking         | Allow students to follow the progress of submissions.          |
| Staff Dashboard         | Provide authorized staff with report management capabilities.  |
| Operational Analytics   | Identify recurring issues and reporting trends.                |

## 4. Responsible Campus Teams

Proposed routing destinations include:

* Housing / Residential Assistants (RAs)
* Facilities
* Dining
* Building Administration
* IT / Technology Support
* Other authorized campus teams

*Final routing responsibilities and integrations will be validated with CBU.*

## 5. Technology Stack

| Component            | Technology                 |
| -------------------- | -------------------------- |
| Mobile Application   | React Native + Expo        |
| Backend              | FastAPI / Python           |
| Database             | PostgreSQL / Supabase      |
| Authentication       | Supabase Auth              |
| AI Processing        | Multimodal AI Model        |
| Image Storage        | Supabase Storage           |
| Similarity Detection | Vector / Similarity Search |
| Notifications        | Push Notifications         |

## 6. Product Boundaries

LancerSnap focuses on routine physical and operational campus reporting.

**Outside the current MVP:**

* Harassment and disciplinary complaints.
* Sensitive personal reports.
* Direct emergency-service dispatch.
* Replacing existing CBU personnel or work-order systems.
* Facial recognition or continuous student tracking.

Lost-and-found remains a secondary reporting category. Physical property handling and ownership decisions remain with the appropriate CBU personnel.

AI-generated information is advisory. Authorized staff remain responsible for operational decisions and issue resolution.

## 7. Project Documentation

The repository maintains three persistent project-context documents:

| File              | Purpose                                                                            |
| ----------------- | ---------------------------------------------------------------------------------- |
| `ARCHITECTURE.md` | System components, data flows, technology boundaries, and architectural decisions. |
| `POLICY.md`       | Business rules, roles, permissions, and product constraints.                       |
| `ROADMAP.md`      | High-level implementation phases and project direction.                            |

Additional project documentation and the Software Design Document are maintained in the `docs/` directory.

## 8. Development Approach

LancerSnap follows a phased implementation strategy.

GitHub Issues represent actionable development tasks, while the GitHub Project organizes implementation progress, priorities, phases, and human review.

AI-generated project artifacts are reviewed by the project owner before being treated as approved implementation tasks.

---

## Project Information

|                   |                                                          |
| ----------------- | -------------------------------------------------------- |
| **Course**        | CSCI 5520 – AI-Driven Software Development               |
| **Institution**   | California Baptist University                            |
| **Project Owner** | Judah Azariah                                            |
| **Repository**    | [LancerSnap](https://github.com/JudahAzariah/LancerSnap) |

---

*LancerSnap — Making campus issue reporting simple for students and actionable for CBU staff.*
