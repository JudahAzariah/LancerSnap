# LancerSnap
AI-Assisted Campus Reporting & Issue Management Platform

LancerSnap is an AI-assisted campus reporting platform designed for California Baptist University (CBU). It enables students to report physical and operational campus issues by simply taking a picture, adding a location, and submitting a report.

The system analyzes submissions, suggests issue categories and priorities, identifies potential duplicate reports, and routes reports to the appropriate CBU team.

The Problem:

Students may encounter problems across campus but may not always know whether to contact Housing, Facilities, Dining, IT, or building administration.

Although CBU already has personnel responsible for these areas, reporting channels can be fragmented, and students may not know where to direct an issue.

LancerSnap provides a centralized reporting experience.

Core Workflow:
A student takes or uploads a photograph.
The student adds or confirms the location.
AI analyzes the report and suggests a category and priority.
The student reviews and confirms the information.
The system checks for potential duplicate reports.
The routing engine identifies the appropriate CBU team.
Authorized staff review and address the issue.
Students receive status updates and can track resolution.
Primary Features
Photo-Based Reporting: Capture or upload an image of a campus issue.
Location Identification: Select or confirm the relevant campus building or area.
AI Classification: Suggest the issue category and extract useful details.
Priority Suggestions: Help distinguish routine issues from potentially urgent ones.
Duplicate Detection: Identify similar reports to reduce unnecessary duplicate work.
Smart Routing: Direct reports to the appropriate CBU team.
Report Tracking: Allow students to follow the progress of submissions.
Staff Dashboard: Provide authorized staff with report management capabilities.
Operational Analytics: Identify recurring issues and reporting trends.
Responsible Campus Teams

Proposed routing destinations include:

Housing / Residential Assistants
Facilities
Dining
Building Administration
IT / Technology Support
Other authorized campus teams

Final routing responsibilities and integrations will need to be validated with CBU.

Technology Stack
Mobile Application	React Native + Expo
Backend	FastAPI / Python
Database	PostgreSQL / Supabase
Authentication	Supabase Auth
AI Processing	Multimodal AI model
Image Storage	Supabase Storage
Similarity Detection	Vector / similarity search
Notifications	Push notifications
Product Boundaries

LancerSnap is designed to support routine physical and operational campus reporting.

Harassment reports, disciplinary complaints, and sensitive personal reports are outside the current MVP scope.

LancerSnap does not replace CBU personnel, existing work-order systems, or emergency services.

Lost-and-found remains a secondary reporting category. Physical property handling and ownership decisions remain with the appropriate CBU personnel and existing processes.

AI-generated information is advisory. Authorized personnel remain responsible for operational decisions and issue resolution.

Project Documentation

The repository maintains three persistent project-context documents:

ARCHITECTURE.md — System components, data flows, technology boundaries, and architectural decisions.
POLICY.md — Business rules, roles, permissions, and product constraints.
ROADMAP.md — High-level implementation phases and project direction.

Additional project documentation and the Software Design Document are maintained in the docs/ directory.

Development Approach

LancerSnap will be developed through phased implementation.

GitHub Issues will represent actionable development tasks, while the GitHub Project will organize implementation progress, priorities, phases, and human review.

AI-generated project artifacts will be reviewed by the project owner before being treated as approved implementation tasks.

Project

Course: CSCI 5520 – AI-Driven Software Development
Institution: California Baptist University
Project Owner: Judah Azariah
