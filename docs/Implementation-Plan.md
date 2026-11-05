# LancerSnap

## Implementation Plan

| Document Information | Details                                    |
| :------------------- | :----------------------------------------- |
| Course               | CSCI 5520 – AI-Driven Software Development |
| Project Owner        | Judah Azariah                              |
| Institution          | California Baptist University              |
| Document Version     | 1.0                                        |
| Source Document      | Software Design Document v0.2              |

---

# 1. Implementation Overview

## 1.1 Implementation Objective

The purpose of this Implementation Plan is to translate the LancerSnap Software Design Document (SDD) into an ordered, implementation-ready development strategy.

LancerSnap is an AI-assisted campus reporting and issue-routing platform designed for California Baptist University (CBU). It enables students to report physical and operational campus issues by taking a photograph, adding a location, and submitting a report.

The system uses AI to suggest issue categories, extract useful information, recommend priority levels, identify potential duplicate reports, and assist with routing submissions to the appropriate CBU team.

Implementation will follow five phases:

1. Foundation, Authentication, and Database.
2. Photo-Based Campus Reporting.
3. AI Classification, Duplicate Detection, and Smart Routing.
4. Staff Dashboard, Status Tracking, and Resolution.
5. Analytics, Testing, and Quality Assurance.

Each phase will produce a demonstrable increment of the application. Development tasks will be decomposed into GitHub Issues, organized through a GitHub Project, and reviewed before being considered approved implementation work.

The implementation strategy prioritizes a working reporting pipeline before introducing advanced AI capabilities.

## 1.2 Source Design Artifacts

This plan is derived from the following project artifacts.

| Artifact                      | Relevant Sections                                     |
| :---------------------------- | :---------------------------------------------------- |
| Software Design Document v0.2 | Sections 1–2: Problem, users, solution, and MVP scope |
| Software Design Document v0.2 | Section 3: User stories and acceptance criteria       |
| Software Design Document v0.2 | Section 4: Requirements and constraints               |
| Software Design Document v0.2 | Section 5: Platform and architecture                  |
| Software Design Document v0.2 | Section 6: UI/UX design                               |
| Software Design Document v0.2 | Section 7: Design decisions, assumptions, and risks   |
| Figma Make Prototype          | Student reporting and staff experience references     |

### Requirement Traceability References

**Student requirements**

* `US-01` — Submit Report
* `US-02` — AI Classify Report
* `US-03` — Track Report
* `US-04` — Receive Resolution Update
* `US-05` — Reopen Report
* `US-06` — Report Location

**Campus staff requirements**

* `US-07` — View Assigned Reports
* `US-08` — Review AI Information
* `US-09` — Update Report Status
* `US-10` — Resolve Report

**Administrator requirements**

* `US-11` — Manage Routing
* `US-12` — View Report Trends
* `US-13` — Manage Categories

**Requirement constraints**

`RC-01` through `RC-12` define access control, AI uncertainty, human oversight, configurable routing, team-based routing, duplicate handling, safety priority, emergency boundaries, secure media, error handling, accessibility, and status transparency.

## 1.3 Planning Assumptions and Scope Guardrails

The implementation follows these assumptions:

* The application will use React Native and Expo.
* FastAPI will provide backend APIs and application business logic.
* Supabase will provide authentication, PostgreSQL database services, and protected image storage.
* An external multimodal AI service will support image and text analysis.
* AI classifications and priority levels are recommendations, not guaranteed facts.
* Reports will be routed to organizational teams or roles rather than permanently depending on individual employees.
* Actual CBU routing responsibilities and staff integrations must be validated before production deployment.
* Report submission must remain functional when external AI services fail.

### MVP Scope Guardrails

The following are outside the current MVP:

* Harassment and disciplinary reporting.
* Sensitive personal complaints.
* Direct emergency-service dispatch.
* Replacing CBU's existing work-order systems.
* Facial recognition.
* Continuous GPS tracking.
* Automated administrative decisions.
* Automated ownership decisions for lost-and-found items.
The implementation will prioritize photo-based campus reporting.

---

# 2. Phase Summary

The development strategy is divided into five ordered implementation phases.

| Phase   | Implementation Focus            | Expected Outcome                                    |
| :------ | :------------------------------ | :-------------------------------------------------- |
| Phase 1 | Foundation and Authentication   | Working application foundation and secure access    |
| Phase 2 | Photo-Based Reporting           | Students can submit and track campus reports        |
| Phase 3 | AI and Smart Routing            | Reports are analyzed and routed to configured teams |
| Phase 4 | Staff Dashboard and Resolution  | Staff can manage reports and update their status    |
| Phase 5 | Analytics and Quality Assurance | Validated MVP with operational insights             |

---

# 3. Detailed Implementation Phases

## Phase 1 — Foundation, Authentication, and Database

### Goal

Establish the technical foundation of LancerSnap, including the mobile application structure, backend services, authentication, database schema, and access-control boundaries.

### Source Requirements and Design References

* SDD Sections 2 and 5.
* `US-07` — View Assigned Reports.
* `RC-01` — Access Control.
* `RC-09` — Secure Media.
* `DD-05` — Team-Based Routing.

### Deliverables

1. Initialize the React Native and Expo application.
2. Establish the FastAPI backend project.
3. Configure Supabase authentication and database connectivity.
4. Create the initial database schema.
5. Define student, staff, and administrator roles.
6. Establish environment-variable and secret-management conventions.
7. Create initial campus location and report category reference data.
8. Establish separate frontend and backend development structures.

### Acceptance Criteria

* The mobile application starts successfully.
* The backend responds to a health-check request.
* Database connectivity is verified.
* An authorized user can authenticate.
* Application roles are defined.
* Database access policies restrict unauthorized access.
* Environment secrets are not committed to GitHub.
* Initial database migrations can be applied successfully.

### Dependencies and Sequence Notes

This phase is the foundation for every subsequent phase.

Database structure and authentication must be established before report creation or staff functionality is introduced.

The reporting model must support the student, staff, and administrator roles defined in the SDD.

### Relevant UI/UX Artifacts

* Login screen.
* Authentication flow.
* Student home screen.
* Staff navigation.

### Candidate GitHub Issues

* `LS-01` — Establish frontend and backend project structure.
* `LS-02` — Configure Supabase authentication.
* `LS-03` — Design initial PostgreSQL database schema.
* `LS-04` — Implement role-based access control.
* `LS-05` — Establish campus locations and report categories.

---

## Phase 2 — Photo-Based Campus Reporting

### Goal

Implement the primary student experience: submitting a campus issue using a photograph, optional description, and location.

The main objective is to minimize the effort required from students.

### Source Requirements and Design References

* SDD Sections 2 and 6.
* `US-01` — Submit Report.
* `US-03` — Track Report.
* `US-06` — Report Location.
* `RC-09` — Secure Media.
* `RC-12` — Status Transparency.
* `DD-01` — Photo-First Reporting.

### Deliverables

1. Implement the Snap & Report screen.
2. Support image capture and image selection.
3. Implement image upload to protected storage.
4. Allow students to add an optional description.
5. Implement campus building and location selection.
6. Develop the report submission API.
7. Store report metadata and image references.
8. Generate a unique report identifier.
9. Provide successful report-submission confirmation.
10. Implement a basic My Reports screen.

### Acceptance Criteria

* A student can capture or upload a photograph.
* A student can enter an optional description.
* A student can select a supported campus location.
* The backend successfully receives a valid submission.
* Report metadata is stored in the database.
* Photographs are stored using protected access.
* Each report receives a unique identifier.
* The student receives a submission confirmation.
* Students can view their own submitted reports.

### Dependencies and Sequence Notes

Phase 2 depends on authentication, database configuration, and image-storage setup from Phase 1.

The report model should be established before AI analysis is introduced.

Basic report submission must remain functional independently of the AI service.

### Relevant UI/UX Artifacts

* Student Home.
* Snap & Report.
* Photo Capture / Upload.
* Location Selection.
* Report Confirmation.
* My Reports.
* Report Details.

### Candidate GitHub Issues

* `LS-06` — Implement photo capture and upload interface.
* `LS-07` — Implement campus location selection.
* `LS-08` — Configure protected report image storage.
* `LS-09` — Implement report submission API.
* `LS-10` — Implement My Reports and report details.

---

## Phase 3 — AI Classification, Duplicate Detection, and Smart Routing

### Goal

Introduce the AI processing layer and routing engine.

This phase transforms a basic report-submission application into an AI-assisted reporting platform.

### Source Requirements and Design References

* SDD Sections 2, 4, and 5.
* `US-02` — AI Classify Report.
* `US-11` — Manage Routing.
* `RC-02` — AI Uncertainty.
* `RC-04` — Configurable Routing.
* `RC-05` — Team-Based Routing.
* `RC-06` — Duplicate Handling.
* `RC-07` — Safety Priority.
* `RC-10` — Error Handling.
* `DD-03` — AI-Assisted Classification.
* `DD-04` — Smart Routing.
* `DD-06` — Duplicate-Aware Reporting.

### Deliverables

1. Establish AI service integration.
2. Define a structured AI response format.
3. Implement image and text-based report classification.
4. Extract useful details from submitted reports.
5. Generate priority recommendations.
6. Implement AI uncertainty and failure handling.
7. Develop a duplicate-report detection mechanism.
8. Create configurable category-to-team routing rules.
9. Implement location-aware routing logic.
10. Provide a fallback process for uncertain classifications or routing decisions.

### AI Classification

The AI service should return structured information including:

* Suggested category.
* Report summary.
* Extracted issue details.
* Suggested priority.
* Classification confidence or uncertainty information.

AI output must be validated before it is stored or used by downstream services.

### Duplicate Detection

Potentially similar reports should be identified using:

* Report category.
* Campus location.
* Submission time.
* Description similarity.
* Image similarity, where implemented.

A duplicate suggestion must not automatically merge unrelated issues. Appropriate confirmation or staff review must be available.

### Smart Routing

The routing engine will use configurable rules based on:

**Location + Category + Priority**

Possible destinations include:

* Housing / Residential Assistants.
* Facilities.
* Dining.
* Building Administration.
* IT / Technology Support.
* Other configured CBU teams.

Actual CBU routing configurations remain subject to validation.

### Acceptance Criteria

* A report can be submitted for AI analysis.
* The AI service returns a supported structured response.
* The system identifies a supported report category.
* Priority is returned as a recommendation.
* Uncertain classifications are identified.
* AI processing failures do not result in false successful reports.
* Potential duplicate reports can be identified.
* Administrators can configure supported routing rules.
* Reports are routed according to the active configuration.
* Reports without a valid routing destination can enter a manual-review process.

### Dependencies and Sequence Notes

Phase 3 depends on the report schema and submission API from Phase 2.

AI classification must be implemented before routing recommendations can be used.

Routing rules should be independent of specific employee identities.

Duplicate detection should initially prioritize category, location, and time before introducing advanced image similarity mechanisms.

### Relevant UI/UX Artifacts

* AI Analysis screen.
* Suggested Category.
* Suggested Priority.
* Review and Confirm.
* Potential Duplicate Report.
* Report Submission Confirmation.
* Administrator Routing Configuration.

### Candidate GitHub Issues

* `LS-11` — Establish AI service integration.
* `LS-12` — Define structured AI classification schema.
* `LS-13` — Implement image and text classification.
* `LS-14` — Implement priority recommendations and uncertainty handling.
* `LS-15` — Implement duplicate-report detection.
* `LS-16` — Develop configurable routing engine.
* `LS-17` — Implement manual-review fallback.

---

## Phase 4 — Staff Dashboard, Status Tracking, and Resolution

### Goal

Provide authorized CBU personnel with the ability to review, assign, update, and resolve incoming reports.

Students must also be able to track the progress of their submissions.

### Source Requirements and Design References

* SDD Sections 2, 3, and 6.
* `US-03` — Track Report.
* `US-04` — Receive Resolution Update.
* `US-05` — Reopen Report.
* `US-07` — View Assigned Reports.
* `US-08` — Review AI Information.
* `US-09` — Update Report Status.
* `US-10` — Resolve Report.
* `RC-01` — Access Control.
* `RC-03` — Human Oversight.
* `RC-12` — Status Transparency.

### Deliverables

1. Develop the CBU staff dashboard.
2. Implement team-specific report queues.
3. Allow staff to review photographs and descriptions.
4. Display AI-generated classification and priority suggestions.
5. Implement report assignment or acceptance.
6. Implement authorized report-status updates.
7. Establish a report-status timeline.
8. Configure student status notifications.
9. Implement issue resolution.
10. Implement the student report-reopening workflow.

### Report Status Model

| Status      | Description                                                   |
| :---------- | :------------------------------------------------------------ |
| Submitted   | The report has been received.                                 |
| Assigned    | The report has been assigned to an authorized team or person. |
| In Progress | Staff are actively addressing the issue.                      |
| Resolved    | Staff have marked the issue as resolved.                      |
| Reopened    | The student indicates that the issue remains unresolved.      |
| Closed      | The reporting workflow has been completed.                    |

Permitted status transitions must be enforced by the backend.

### Acceptance Criteria

* Authorized staff can access their permitted report queues.
* Staff can view report details and uploaded photographs.
* AI-generated information is visible to authorized staff.
* Staff can assign or accept reports.
* Authorized staff can update report statuses.
* Students can view updated status information.
* Students receive configured status notifications.
* Staff can mark reports as resolved.
* Students can reopen reports that remain unresolved.
* Unauthorized users cannot modify report status.

### Dependencies and Sequence Notes

Phase 4 depends on the report-processing and routing functionality established in Phases 1–3.

Staff functionality must respect the role-based permissions established during Phase 1.

The backend must remain the authoritative source for report status.

Notifications communicate status changes but do not replace status information stored in the database.

### Relevant UI/UX Artifacts

* Staff Dashboard.
* Report Queue.
* Report Details.
* Assignment Controls.
* Status Management.
* Student Status Timeline.
* Notification Interface.
* Reopen Report Flow.

### Candidate GitHub Issues

* `LS-18` — Develop CBU staff dashboard and report queue.
* `LS-19` — Implement staff report details and AI information display.
* `LS-20` — Implement report assignment and status transitions.
* `LS-21` — Implement student status notifications.
* `LS-22` — Implement report resolution and reopening.

---

## Phase 5 — Analytics, Testing, and Quality Assurance

### Goal

Validate the complete reporting workflow and provide basic operational insights for administrators.

This phase ensures that the MVP behaves reliably, protects data, and satisfies the defined acceptance criteria.

### Source Requirements and Design References

* SDD Sections 2, 3, 4, and 7.
* `US-12` — View Report Trends.
* `US-13` — Manage Categories.
* `RC-01` through `RC-12`.
* `DD-09` — Emergency Boundary.
*  DD-10 — Campus Reporting MVP Boundary

### Deliverables

1. Implement basic operational analytics.
2. Provide report counts by category.
3. Provide report counts by campus location.
4. Provide report counts by status.
5. Implement basic resolution-time summaries.
6. Validate authentication and authorization.
7. Test protected image storage.
8. Test report creation and status transitions.
9. Test AI failure and fallback behavior.
10. Test duplicate detection and routing.
11. Validate mobile accessibility and usability.
12. Prepare an end-to-end demonstration.

### Acceptance Criteria

* Administrators can view supported report trends.
* Reports can be grouped by category and location.
* Report status counts are displayed correctly.
* Basic resolution-time information can be calculated.
* Students cannot access other students' private reports.
* Staff cannot access unauthorized team queues.
* Protected images cannot be accessed without authorization.
* AI failures are handled without losing valid submissions.
* Routing failures are handled appropriately.
* Core reporting and tracking workflows pass end-to-end tests.
* Documented MVP boundaries are preserved.

### Dependencies and Sequence Notes

Phase 5 depends on the completion of the core reporting, AI, routing, and staff workflows.

Analytics should use persisted report data rather than independently maintained counters.

Security and access-control tests should validate the complete application, not only individual API endpoints.

### Relevant UI/UX Artifacts

* Administrator Dashboard.
* Report Analytics.
* Category and Location Filters.
* Final Student Reporting Flow.
* Final Staff Resolution Flow.

### Candidate GitHub Issues

* `LS-23` — Implement administrator reporting analytics.
* `LS-24` — Perform security, privacy, and accessibility testing.
* `LS-25` — Implement end-to-end testing and final MVP validation.

---

# 4. Cross-Phase Dependencies and Implementation Sequence

The implementation phases follow a dependency-driven sequence.

The foundation must be established before the reporting workflow can be implemented. AI functionality depends on report creation, while staff resolution depends on reports being successfully classified and routed.

### Primary Dependency Flow

```text
Phase 1
Foundation and Authentication
        |
        v
Phase 2
Photo-Based Reporting
        |
        v
Phase 3
AI Classification and Smart Routing
        |
        v
Phase 4
Staff Dashboard and Resolution
        |
        v
Phase 5
Analytics and Quality Assurance
```

Some activities can overlap after their technical dependencies are satisfied. For example, staff dashboard layouts can be designed during Phase 2, while integration with actual report queues depends on the backend established in earlier phases.

## 4.1 Dependency Table

| Phase   | Depends On | Main Dependency                                         |
| :------ | :--------- | :------------------------------------------------------ |
| Phase 1 | None       | Establishes the application and data foundation.        |
| Phase 2 | Phase 1    | Requires authentication, database, and storage.         |
| Phase 3 | Phases 1–2 | Requires persisted reports, photos, and locations.      |
| Phase 4 | Phases 1–3 | Requires reports, AI results, routing, and permissions. |
| Phase 5 | Phases 1–4 | Requires completed reporting and resolution workflows.  |

### Critical Dependency Rules

1. The report database model must exist before implementing report APIs.
2. Image storage must be configured before enabling report photo uploads.
3. Report submission must work before introducing AI analysis.
4. Structured AI output must be validated before it is used by the routing engine.
5. Routing configuration must exist before reports can be directed to operational teams.
6. Role-based permissions must be enforced before enabling staff report management.
7. Status transitions must be implemented before student notifications are triggered.
8. Persisted report information must exist before operational analytics are developed.

---

# 5. GitHub Issue Decomposition Guidance

## 5.1 Issue Creation Strategy

The implementation phases will be decomposed into small, independently manageable GitHub Issues.

AI coding agents may assist with:

* Identifying development tasks from the Implementation Plan.
* Drafting GitHub Issue descriptions.
* Generating acceptance criteria.
* Suggesting labels and priorities.
* Identifying implementation dependencies.
* Creating candidate GitHub Issues.
* Organizing issues into the GitHub Project.

AI-generated issues must be reviewed before they are treated as approved development work.

### Required Issue Structure

Each GitHub Issue should contain:

1. Issue title.
2. Problem or objective.
3. Expected functionality.
4. Relevant SDD requirement identifiers.
5. Implementation deliverables.
6. Acceptance criteria.
7. Dependencies.
8. Suggested phase.
9. Suggested priority.
10. Relevant technical considerations.

### Issue Naming Convention

Candidate issues will use stable identifiers:

`LS-01`, `LS-02`, `LS-03`, and so on.

These identifiers provide traceability between the Implementation Plan and GitHub Issues.

### Suggested GitHub Labels

| Label           | Purpose                             |
| :-------------- | :---------------------------------- |
| `frontend`      | Mobile application tasks            |
| `backend`       | API and business logic              |
| `database`      | Schema, migrations, and data access |
| `ai`            | AI processing and classification    |
| `routing`       | Routing and duplicate detection     |
| `security`      | Authentication and authorization    |
| `testing`       | Validation and quality assurance    |
| `documentation` | Project documentation               |
| `enhancement`   | New application functionality       |
| `bug`           | Defect or incorrect behavior        |

### Human Review Process

The GitHub Project will include a **Human Review** field with two values:

* `Pending`
* `Reviewed`

All AI-created issues must initially be marked `Pending`.

After personally checking the objective, acceptance criteria, dependencies, and scope of an issue, the project owner can change the field to `Reviewed`.

An issue must not be considered approved merely because an AI agent created it successfully.

## 5.2 Candidate Issue Inventory

The following inventory provides the initial implementation backlog.

| ID    | GitHub Issue                                                | Phase | Priority |
| :---- | :---------------------------------------------------------- | :---: | :------: |
| LS-01 | Establish frontend and backend project structure            |   1   |   High   |
| LS-02 | Configure Supabase authentication                           |   1   |   High   |
| LS-03 | Design initial PostgreSQL database schema                   |   1   |   High   |
| LS-04 | Implement role-based access control                         |   1   |   High   |
| LS-05 | Establish campus locations and report categories            |   1   |  Medium  |
| LS-06 | Implement photo capture and upload interface                |   2   |   High   |
| LS-07 | Implement campus location selection                         |   2   |   High   |
| LS-08 | Configure protected report image storage                    |   2   |   High   |
| LS-09 | Implement report submission API                             |   2   |   High   |
| LS-10 | Implement My Reports and report details                     |   2   |  Medium  |
| LS-11 | Establish AI service integration                            |   3   |   High   |
| LS-12 | Define structured AI classification schema                  |   3   |   High   |
| LS-13 | Implement image and text classification                     |   3   |   High   |
| LS-14 | Implement priority recommendations and uncertainty handling |   3   |   High   |
| LS-15 | Implement duplicate-report detection                        |   3   |  Medium  |
| LS-16 | Develop configurable routing engine                         |   3   |   High   |
| LS-17 | Implement manual-review fallback                            |   3   |   High   |
| LS-18 | Develop CBU staff dashboard and report queue                |   4   |   High   |
| LS-19 | Implement staff report details and AI information display   |   4   |   High   |
| LS-20 | Implement report assignment and status transitions          |   4   |   High   |
| LS-21 | Implement student status notifications                      |   4   |  Medium  |
| LS-22 | Implement report resolution and reopening                   |   4   |   High   |
| LS-23 | Implement administrator reporting analytics                 |   5   |  Medium  |
| LS-24 | Perform security, privacy, and accessibility testing        |   5   |   High   |
| LS-25 | Implement end-to-end testing and final MVP validation       |   5   |   High   |

The candidate inventory is the basis for creating detailed GitHub Issues. Each issue must contain its own implementation scope and acceptance criteria.

---

# 6. Risks, Open Decisions, and Agent Guardrails

## 6.1 Implementation Risks

### RISK-01 — Incorrect AI Classification

**Impact:** Reports may receive incorrect categories.

**Mitigation:** Validate AI output and allow human correction.

### RISK-02 — Incorrect Routing

**Impact:** Reports may reach the wrong CBU team.

**Mitigation:** Use configurable routing rules and permit staff reassignment.

### RISK-03 — Duplicate Detection Failure

**Impact:** Similar issues may generate separate reports.

**Mitigation:** Treat duplicate detection as a recommendation and allow human review.

### RISK-04 — False Priority

**Impact:** An issue may receive an inappropriate urgency recommendation.

**Mitigation:** Keep priority advisory and provide conservative safety handling.

### RISK-05 — AI Service Failure

**Impact:** Report analysis may become unavailable.

**Mitigation:** Preserve report submission and provide manual-review fallback.

### RISK-06 — Unauthorized Data Access

**Impact:** Private reports or photographs may be exposed.

**Mitigation:** Enforce role-based access and protected image storage.

### RISK-07 — Notification Failure

**Impact:** Students may not receive status notifications.

**Mitigation:** Keep report status available inside the application.

### RISK-08 — Staff Adoption Challenges

**Impact:** Staff may continue relying entirely on existing communication channels.

**Mitigation:** Minimize additional administrative work and use existing team structures.

### RISK-09 — Unconfirmed CBU Routing Rules

**Impact:** Reports may not reach the actual responsible team.

**Mitigation:** Keep routing destinations configurable and validate them with CBU.

### RISK-10 — Scope Expansion

**Impact:** The MVP may become unnecessarily complex.

**Mitigation:** Enforce documented product boundaries.

## 6.2 Open Decisions

| ID    | Open Decision                                 | Current Status               |
| :---- | :-------------------------------------------- | :--------------------------- |
| OQ-01 | CBU category and location routing rules       | Requires validation          |
| OQ-02 | Integration with existing CBU staff workflows | Undecided                    |
| OQ-03 | Final AI service provider                     | Undecided                    |
| OQ-04 | Duplicate detection approach                  | Requires evaluation          |
| OQ-05 | Campus location identification method         | Requires evaluation          |
| OQ-06 | Notification provider                         | Undecided                    |
| OQ-07 | Production CBU single sign-on integration     | Requires approval and access |

These decisions must be resolved or explicitly recorded before the relevant implementation work is finalized.

## 6.3 AI Agent Guardrails

AI coding agents must follow these rules:

1. Follow the approved SDD and Implementation Plan.
2. Do not introduce functionality outside the documented MVP scope without approval.
3. Do not invent CBU departments, contacts, APIs, or operational procedures.
4. Do not expose credentials, API keys, or environment secrets.
5. Do not weaken authentication, authorization, or image-storage restrictions.
6. Treat AI classification and priority results as recommendations.
7. Do not implement facial recognition or continuous GPS tracking.
8. Do not introduce harassment, disciplinary, or sensitive complaint workflows.
9. Keep routing configurable rather than hard-coding individual staff members.
10. Follow the acceptance criteria associated with each GitHub Issue.
11. Identify unresolved assumptions rather than silently making architectural decisions.
12. Require human review for security-sensitive or scope-changing modifications.

Human approval is required before modifying architectural boundaries, access-control rules, project scope, or CBU-specific operational assumptions.

---

# 7. Handoff to GitHub Project

## 7.1 GitHub Project Structure

The GitHub Project will be titled:

**LancerSnap – Implementation Roadmap**

The project will organize candidate implementation issues according to the five development phases.

### Recommended Project Fields

| Field        | Type          | Purpose                                       |
| :----------- | :------------ | :-------------------------------------------- |
| Status       | Single Select | Tracks implementation progress                |
| Phase        | Single Select | Identifies the implementation phase           |
| Priority     | Single Select | Indicates task importance                     |
| Area         | Single Select | Identifies the technical area                 |
| Human Review | Single Select | Tracks personal review of AI-generated issues |

**Field options**

* **Status:** Backlog, Ready, In Progress, In Review, Done.
* **Phase:** Phase 1, Phase 2, Phase 3, Phase 4, Phase 5.
* **Priority:** Critical, High, Medium, Low.
* **Area:** Frontend, Backend, AI, Database, Security, Testing, DevOps, Documentation.
* **Human Review:** Pending, Reviewed.

### Project Views

**1. Board View**

Organizes issues by Status.

**2. Phase View**

Groups implementation tasks by Phase.

**3. Priority View**

Highlights high-priority and critical work.

**4. Human Review View**

Displays AI-generated issues awaiting personal review.

## 7.2 Issue-to-Phase Traceability

Each GitHub Issue should identify:

* Candidate Issue ID.
* Relevant SDD requirement ID.
* Implementation phase.
* Priority.
* Area label.
* Dependencies.
* Acceptance criteria.

### Example Traceability

| Artifact             | Reference                               |
| :------------------- | :-------------------------------------- |
| SDD Requirement      | US-01 — Submit Report                   |
| Implementation Phase | Phase 2 — Photo-Based Campus Reporting  |
| Candidate Issue      | LS-09 — Implement report submission API |
| GitHub Project       | LancerSnap – Implementation Roadmap     |

This makes it possible to trace each implementation task back to the original product requirement.

## 7.3 Final Readiness Checklist

### Implementation Plan

* [ ] Implementation overview completed.
* [ ] Source design artifacts identified.
* [ ] Planning assumptions and scope guardrails documented.
* [ ] Five implementation phases defined.
* [ ] Deliverables specified for every phase.
* [ ] Acceptance criteria specified for every phase.
* [ ] Dependencies documented.
* [ ] UI/UX references identified.
* [ ] Candidate GitHub Issues identified.
* [ ] Risks and open decisions documented.
* [ ] AI agent guardrails defined.

### GitHub Issues

* [ ] Candidate issues created.
* [ ] Each issue has a clear objective.
* [ ] Each issue has acceptance criteria.
* [ ] SDD requirements are referenced.
* [ ] Dependencies are documented.
* [ ] Labels and phases are assigned.
* [ ] AI-generated issues are marked Pending.
* [ ] Personally reviewed issues are marked Reviewed.

### GitHub Project

* [ ] Project created.
* [ ] Relevant issues added.
* [ ] Status field configured.
* [ ] Phase field configured.
* [ ] Priority field configured.
* [ ] Area field configured.
* [ ] Human Review field configured.
* [ ] Project views organized.

### Persistent Project Context

* [ ] `ARCHITECTURE.md` created.
* [ ] `POLICY.md` created.
* [ ] `ROADMAP.md` created.
* [ ] Documentation committed to the repository.
* [ ] Documentation aligns with the updated SDD.

### Final Handoff

* [ ] SDD requirement-to-phase-to-issue traceability verified.
* [ ] GitHub Project reflects the implementation backlog.
* [ ] AI-generated work has been personally reviewed.
* [ ] Repository is ready for implementation.

---

**End of LancerSnap Implementation Plan**
