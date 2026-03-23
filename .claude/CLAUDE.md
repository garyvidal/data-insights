## Project Overview section

This is a full-stack project: React/TypeScript frontend + Java/Spring Boot backend and MarkLogic as the database. Always consider both sides when making changes to shared models or APIs.

## UI/Styling section

When fixing UI theme/contrast issues, check ALL affected components in both light and dark modes before declaring the fix complete. Use grep to find other usages of the same CSS variables or class names.

## Java Backend section

This project uses Lombok. Be aware of Lombok + Java 23 compatibility issues. If annotation processing fails, rewrite with explicit constructors/getters rather than debugging Lombok config.
 
## Development Guidelines section
After refactoring or adding UI features, always verify that existing functionality still works — especially test connection, drag-and-drop, table selection, and modal positioning. Run a mental checklist of side effects.

## Important Behaviors section

When the user asks to 'save a plan' or 'save this for later', just write the content to a markdown file in the appropriate docs folder. Do NOT start implementing or exploring the codebase.