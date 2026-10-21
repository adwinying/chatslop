# Linear Threads; regenerate and edit truncate

A Thread is a strictly linear list of Messages in one `messages` table. Regenerating an Answer or editing a Prompt deletes every Message after it, without asking. Branching is out of the MVP, and if it comes later it copies Messages into a new Thread rather than turning a Thread into a tree. Linear keeps the data model, Context building and search simple ([Data model](https://github.com/adwinying/chatslop/issues/10)).
