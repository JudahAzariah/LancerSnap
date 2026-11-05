# LancerSnap — Development Roadmap

## 1. Purpose

This roadmap defines the planned implementation sequence for LancerSnap.

It provides persistent context for developers and AI coding agents by explaining the major implementation phases, their goals, dependencies, and relationship to the GitHub Issue backlog.

The detailed implementation work is tracked in GitHub Issues and the GitHub Project.

---

## 2. Product Direction

LancerSnap is being developed as a CBU campus reporting application centered on a simple, photo-first reporting experience.

**Student workflow:**

`Capture Photo → Select Location → Add Optional Details → Submit`

The system then uses backend processing and AI-assisted capabilities to classify, prioritize, detect possible duplicates, and route reports before authorized staff manage resolution.

The current MVP does **not** include lost-and-found, harassment, disciplinary, sensitive-case, facial-recognition, continuous-GPS, or direct-emergency-dispatch workflows.

---

# Phase 1 — Foundation, Authentication, and Database

## Goal

Establish the technical foundation required for secure reporting and role-aware access.

## Major work

- Establish frontend and backend project structure.
- Configure Supabase authentication.
- Design the PostgreSQL database schema.
- Implement role-based access control.
- Establish campus locations and report categories.

## GitHub Issues

- **LS-01** — Establish frontend and backend project structure
- **LS-02** — Configure Supabase authentication
- **LS-03** — Design initial PostgreSQL database schema
- **LS-04** — Implement role-based access control
- **LS-05** — Establish campus locations and report categories

## Dependencies

Phase 1 is foundational for the remaining implementation phases.

Authentication, database structure, authorization, categories, and location configuration must be established before dependent reporting and routing work proceeds.

## Exit criteria

Phase 1 is complete when:

- Frontend and backend foundations are established.
- Authentication works.
- Core database structures exist.
- RBAC is enforced.
- Approved campus locations and report categories are available.

---

# Phase 2 — Photo-Based Campus Reporting

## Goal

Implement the core student reporting workflow.

## Major work

- Photo capture and upload.
- Campus location selection.
- Protected report image storage.
- Report submission API.
- Student report history and report details.

## GitHub Issues

- **LS-06** — Implement photo capture and upload interface
- **LS-07** — Implement campus location selection
- **LS-08** — Configure protected report image storage
- **LS-09** — Implement report submission API
- **LS-10** — Implement My Reports and report details

## Dependencies

Phase 2 depends on the authentication, authorization, database, location, and category foundations established in Phase 1.

## Exit criteria

Phase 2 is complete when an authenticated student can:

1. Capture or select a report photograph.
2. Provide a campus location.
3. Add optional details.
4. Submit a report.
5. Have the report stored securely.
6. View appropriate information about their submitted report.

The student should not be required to determine which operational team will receive the report.

---

# Phase 3 — AI Classification, Duplicate Detection, and Smart Routing

## Goal

Add AI-assisted processing and configurable routing while preserving human oversight.

## Major work

- Establish AI service integration.
- Define structured AI classification outputs.
- Implement image and text classification.
- Implement priority recommendations and uncertainty handling.
- Detect possible duplicate reports.
- Develop configurable routing.
- Provide manual-review fallback.

## GitHub Issues

- **LS-11** — Establish AI service integration
- **LS-12** — Define structured AI classification schema
- **LS-13** — Implement image and text classification
- **LS-14** — Implement priority recommendations and uncertainty handling
- **LS-15** — Implement duplicate-report detection
- **LS-16** — Develop configurable routing engine
- **LS-17** — Implement manual-review fallback

## Dependencies

Phase 3 depends on submitted reports, categories, authentication, database structures, and the relevant frontend/backend foundations.

## AI principle

AI outputs are advisory unless an approved project decision explicitly defines an automated action.

Low-confidence or ambiguous results must have an appropriate fallback path.

## Exit criteria

Phase 3 is complete when:

- Reports can be processed by the AI layer.
- Classification outputs follow a defined structure.
- Priority recommendations include appropriate uncertainty handling.
- Possible duplicate reports can be identified.
- Reports can be routed through configurable rules.
- Ambiguous cases can be handled through manual review.

---

# Phase 4 — Staff Dashboard, Status Tracking, and Resolution

## Goal

Provide authorized staff with the tools needed to manage reports from intake through resolution.

## Major work

- Staff dashboard and report queue.
- Staff report details.
- AI information display.
- Report assignment.
- Status transitions.
- Student notifications.
- Resolution and reopening.

## GitHub Issues

- **LS-18** — Develop CBU staff dashboard and report queue
- **LS-19** — Implement staff report details and AI information display
- **LS-20** — Implement report assignment and status transitions
- **LS-21** — Implement student status notifications
- **LS-22** — Implement report resolution and reopening

## Dependencies

Phase 4 depends on the authentication/RBAC foundation and the reporting, AI, and routing capabilities developed in earlier phases.

## Exit criteria

Authorized staff can:

- View appropriate report queues.
- Review report details.
- Review AI-generated information.
- Assign reports.
- Update permitted statuses.
- Resolve reports.
- Reopen reports where appropriate.

Students receive appropriate status information without gaining staff-level workflow permissions.

---

# Phase 5 — Analytics, Testing, and Quality Assurance

## Goal

Validate the complete MVP and provide administrative visibility into system operation.

## Major work

- Administrative reporting analytics.
- Security testing.
- Privacy testing.
- Accessibility testing.
- End-to-end testing.
- Final MVP validation.

## GitHub Issues

- **LS-23** — Implement administrator reporting analytics
- **LS-24** — Perform security, privacy, and accessibility testing
- **LS-25** — Implement end-to-end testing and final MVP validation

## Dependencies

Phase 5 depends on the completed reporting, AI, routing, staff workflow, and resolution functionality.

## Exit criteria

The MVP is ready for final validation when:

- Administrative analytics are available.
- Security controls have been tested.
- Privacy requirements have been evaluated.
- Accessibility has been tested.
- End-to-end workflows have been validated.
- Critical MVP issues have been resolved or explicitly accepted.

---

# 3. Cross-Phase Dependencies

The implementation follows a dependency-driven sequence:

```text
Phase 1
Foundation
   │
   ├───────────────┐
   ↓               ↓
Phase 2          Phase 3
Reporting       AI + Routing
   │               │
   └───────┬───────┘
           ↓
        Phase 4
   Staff Operations
           │
           ↓
        Phase 5
 Testing + Validation
```

The phases are not completely independent.

Examples:

- Authentication supports protected reporting.
- Database design supports report persistence.
- Categories and locations support classification and routing.
- Report submission supports AI processing.
- AI and routing support staff queues.
- Staff status management supports notifications and resolution.
- Completed workflows are required for meaningful end-to-end testing.

---

# 4. GitHub Issue Backlog

The detailed implementation backlog is represented by:

**LS-01 through LS-25**

These issues are the actionable decomposition of the Implementation Plan.

The current GitHub Project should be treated as the primary progress-tracking mechanism for implementation work.

Each issue should retain:

- Phase
- Priority
- Dependencies
- SDD traceability
- Acceptance criteria
- Testing expectations
- Human Review status

---

# 5. Milestone and Priority Guidance

The roadmap does not assign artificial deadlines.

Implementation should follow dependency order rather than simply working on issues in numerical order.

High-priority work should generally be completed before dependent Medium-priority work. GitHub Issue dependencies remain the authoritative representation of technical prerequisites.

---

# 6. Open Decisions

The following decisions remain subject to project approval and should not be silently invented by developers or AI coding agents.

- **OQ-01:** Campus routing configuration
- **OQ-02:** Staff dashboard operational behavior
- **OQ-03:** AI service/integration decisions
- **OQ-04:** Duplicate detection behavior and thresholds
- **OQ-05:** Location/category configuration decisions
- **OQ-06:** Student notification behavior
- **OQ-07:** Production single sign-on considerations

Open decisions should be documented when resolved and reflected in affected project artifacts.

---

# 7. Change Management

Changes to the roadmap should remain synchronized with the Implementation Plan and GitHub backlog.

If a major requirement changes:

**SDD → Implementation Plan → Roadmap → GitHub Issues → Project**

must be reviewed for consistency.

A change should not silently invalidate existing dependencies or acceptance criteria.

---

# 8. Current MVP Boundary

The current MVP focuses on campus issue reporting.

The roadmap does not include:

- Lost-and-found functionality
- Harassment reporting
- Disciplinary workflows
- Sensitive-case workflows
- Facial recognition
- Continuous GPS tracking
- Direct emergency dispatch

These may only be introduced through an explicitly approved scope change.

---

# 9. AI Agent Use

An AI coding agent should read this roadmap before planning implementation work.

The roadmap provides:

- Phase context
- Implementation sequence
- Major dependencies
- Current MVP boundaries
- Open decisions
- Relationship between project documentation and GitHub Issues

For detailed implementation instructions, the agent should then inspect the relevant GitHub Issue and the corresponding SDD and Implementation Plan sections.

---

# 10. Definition of Roadmap Completion

The roadmap is considered complete for the current MVP when all five phases have been implemented, tested, and validated according to the approved acceptance criteria and project decisions.

Completion of a phase does not authorize expansion of project scope.

Any future functionality should be introduced through the project's change-management process.
