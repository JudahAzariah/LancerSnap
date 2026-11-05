# LancerSnap — Project Policy

## 1. Purpose

This document defines the product, security, privacy, AI, and development policies that govern LancerSnap.

It is persistent project context for developers and AI coding agents. When implementing or modifying LancerSnap, these policies must be followed unless an explicitly approved project decision changes them.

The Software Design Document (SDD) and Implementation Plan remain the authoritative sources for requirements and planned implementation. This document provides implementation guardrails and boundaries.

---

## 2. Product Scope

LancerSnap is a CBU campus reporting application centered on a simple, photo-first reporting workflow.

**Core workflow:**

`Capture Photo → Select Location → Add Optional Details → Submit Report`

The system then supports classification, priority recommendation, duplicate detection, configurable routing, staff handling, status tracking, resolution, notifications, and administrative analytics.

### In scope

- Student campus issue reporting
- Photo capture and upload
- Campus location selection
- Optional report details
- Report categorization
- AI-assisted classification
- AI-assisted priority recommendations
- Duplicate-report detection
- Configurable campus routing
- Manual-review fallback
- Staff report queue
- Report assignment
- Status tracking
- Student status notifications
- Report resolution and reopening
- Administrative analytics
- Security, privacy, accessibility, and end-to-end testing

### Out of scope

Do not introduce the following without an explicitly approved scope change:

- Lost-and-found workflows
- Harassment reporting
- Disciplinary reporting
- Sensitive case-management workflows
- Facial recognition
- Continuous GPS tracking
- Direct emergency dispatch
- Automated ownership decisions
- Unapproved automated administrative decisions

LancerSnap is a campus reporting tool, not an emergency dispatch or disciplinary case-management system.

---

## 3. User Roles and Authorization

Access must follow the role model defined by the SDD.

### Students

Students may:

- Create campus reports.
- Upload report photographs.
- Select the relevant campus location.
- Add optional report details.
- View their own submitted reports.
- Receive appropriate status updates and notifications.

Students must not be able to:

- View another student's private report information.
- Modify staff-only routing or assignment information.
- Access administrative functionality.
- Override staff decisions.

### Staff

Authorized staff may:

- View reports within their authorized operational scope.
- Review report details.
- Review AI-generated classifications and recommendations.
- Assign or update reports according to their permissions.
- Change permitted report statuses.
- Resolve reports.
- Reopen reports when appropriate.

### Administrators

Authorized administrators may:

- Manage categories and configurable reporting information.
- Configure routing rules.
- Review administrative analytics.
- Manage authorized system configuration.
- Perform functions permitted by the RBAC model.

Authorization must be enforced by the backend/database security layer, not only by frontend visibility.

---

## 4. AI Policy

AI is an **assistive component**, not the final authority for administrative decisions.

### AI may assist with

- Report classification
- Image and text interpretation
- Priority recommendations
- Duplicate-report detection
- Routing recommendations
- Uncertainty detection

### AI must not independently

- Make final administrative decisions.
- Automatically dispatch emergency services.
- Make disciplinary decisions.
- Override authorized staff decisions.
- Bypass authentication or authorization.
- Expose protected report information.
- Introduce functionality outside the approved MVP scope.

AI outputs should be treated as recommendations or system signals unless an approved project decision explicitly defines an automated action.

---

## 5. AI Uncertainty and Manual Review

AI results may be incomplete, ambiguous, or incorrect.

The system must preserve an appropriate fallback path when AI confidence or available information is insufficient.

Examples include:

- Low-confidence classification
- Ambiguous category
- Uncertain priority
- Possible duplicate without sufficient evidence
- Routing ambiguity

When human review is required, the system should preserve the report and route it through an appropriate review path rather than silently discarding it or forcing an unreliable AI decision.

---

## 6. Routing Policy

Routing must be configurable.

The application must not hard-code assumptions about CBU departments, personnel, or operational procedures unless those details have been explicitly approved and documented.

Students should not be required to know which operational team is responsible for an issue.

Routing should use appropriate report information such as category, location, priority, and configured routing rules.

Routing configuration should remain maintainable without requiring major changes to the student reporting interface.

---

## 7. Privacy and Data Protection

Reports may contain photographs, locations, descriptions, and other information that should not be publicly exposed.

### Required principles

- Users should only access information authorized for their role.
- Student reports must not be publicly readable by default.
- Report photographs must use protected storage and controlled access.
- Authentication must be required for protected report functionality.
- Backend authorization must be enforced independently of frontend controls.
- Sensitive information should not be unnecessarily exposed in logs or error messages.
- Access to report information should follow least-privilege principles.

Do not introduce public image URLs or unrestricted report storage for implementation convenience.

---

## 8. Photo Handling

Photos are a core input to the reporting workflow.

Implementations must:

- Validate uploaded files.
- Apply appropriate file-size and format constraints.
- Store report images in protected storage.
- Associate images with the appropriate report.
- Prevent unauthorized access.
- Avoid exposing storage credentials to clients.

Original uploaded photographs must remain access-controlled.

Do not introduce facial recognition or biometric processing as part of photo handling.

---

## 9. Location Policy

Location is used to contextualize and route reports.

The application may use:

- User-selected campus locations.
- Approved location data defined by the application.
- Location information associated with a submitted report.

LancerSnap must not implement continuous location tracking.

A user should not be required to continuously share GPS location to use the reporting workflow.

---

## 10. Status and Resolution Policy

Report status changes must follow the workflow defined by the application.

Status transitions must be validated by the backend according to the user's role and permissions.

Students may view appropriate status information but must not directly manipulate staff-only workflow states.

Resolution should represent an authorized staff action.

Reopening a report must follow the permissions and workflow defined by the system.

If the distinction between `Resolved` and `Closed` remains an open design decision, implementation must follow the approved project decision rather than inventing a permanent interpretation.

---

## 11. Accessibility and Usability

The primary student reporting workflow should minimize unnecessary effort.

The interface should prioritize:

- Clear actions
- Minimal required input
- Readable text
- Appropriate labels
- Keyboard and assistive-technology accessibility where applicable
- Clear validation messages
- Clear error recovery
- Mobile-friendly interaction

The user should not need to understand internal architecture, routing rules, AI processing, or staff organization to submit a report.

---

## 12. Security Policy

Security controls must be implemented at the appropriate system layers.

Do not rely solely on frontend restrictions.

Required considerations include:

- Authentication
- Role-based authorization
- Database access control
- Protected image storage
- Input validation
- Secure API behavior
- Secure handling of credentials and secrets
- Appropriate error handling
- Protection against unauthorized report access

Secrets must never be committed to GitHub.

API keys, service credentials, database passwords, authentication secrets, and private configuration values must be stored through appropriate environment or secret-management mechanisms.

---

## 13. Development Policy

Changes should be traceable to an approved requirement, Implementation Plan item, or GitHub Issue.

Developers and AI coding agents should:

1. Read the relevant project context.
2. Identify the related SDD requirement.
3. Check the Implementation Plan phase.
4. Review dependencies.
5. Implement the smallest appropriate change.
6. Add or update tests.
7. Verify security and authorization implications.
8. Avoid unrelated changes.

Do not rewrite unrelated components merely because an AI agent believes an alternative architecture would be better.

---

## 14. AI Coding Agent Guardrails

Before modifying code, an AI coding agent should read:

- `ARCHITECTURE.md`
- `POLICY.md`
- `ROADMAP.md`
- Relevant SDD sections
- Relevant Implementation Plan section
- The associated GitHub Issue

The agent must respect existing architectural boundaries and policies.

An agent must not:

- Expand project scope without approval.
- Reintroduce lost-and-found functionality.
- Invent CBU departments or APIs.
- Add emergency dispatch functionality.
- Add facial recognition.
- Add continuous GPS tracking.
- Bypass RBAC.
- Expose protected report images.
- Commit secrets.
- Replace human administrative decisions with unapproved AI automation.

If a requirement is ambiguous or conflicts with the SDD, Implementation Plan, or this policy, the agent should flag the conflict rather than silently choosing a new project direction.

---

## 15. Change Control

Changes to scope, architecture, security policy, or major workflow decisions should be documented.

A change that affects multiple implementation phases should be reflected in the appropriate project documentation before dependent work is generated.

Changes to the SDD should be accompanied by corresponding updates to the Implementation Plan and, where necessary, GitHub Issues and persistent project context.

---

## 16. Traceability

Implementation work should maintain:

**SDD Requirement → Implementation Plan Phase → GitHub Issue → Implementation → Verification**

For example:

**US-01 → Phase 2 → LS-06 → Photo capture/upload implementation → Acceptance testing**

This traceability should be preserved when requirements or implementation decisions change.

---

## 17. Policy Priority

When making implementation decisions, use the following order of authority:

1. Approved project decisions and constraints
2. SDD v0.2
3. Implementation Plan
4. GitHub Issue acceptance criteria
5. `ARCHITECTURE.md`
6. `POLICY.md`
7. `ROADMAP.md`

If two sources conflict, do not silently resolve the conflict in code. Flag the conflict for human review and update the relevant project documentation after a decision is made.
