# Rules
1. First think through the problem, read the codebase for relevant files, and write a plan to tasks/todo.md.
2. The plan should have a list of todo items that you can check off as you complete them
3. Before you begin working, check in with me and I will verify the plan.
4. Then, begin working on the todo items, marking them as complete as you go.
5. Please every step of the way just give me a high level explanation of what changes you made
6. Make every task and code change you do as simple as possible. We want to avoid making any massive or complex changes. Every change should impact as little code as possible. Everything is about simplicity.
7. Finally, add a review section to the [todo.md](http://todo.md/) file with a summary of the changes you made and any other relevant information.
8. Avoid duplication of code and think like a senior software engineer. Try refactoring code to modules, classes or something of that sort.
9. Always update the postman collection whenever APIs are updated.
10. Keep the routes cleaner and move all the major logic to services.

# Secondary rules
1. No artifacts.
2. Less code is better than more code.
3. No fallback mechanisms — they hide real failures.
4. Rewrite existing components over adding new ones.
5. Flag obsolete files to keep the codebase lightweight.
6. Never say “X remains unchanged” — always show the code.
7. Be explicit on where snippets go (e.g., below “abc”, above “xyz”).
8. If only one function changes, just show that one.