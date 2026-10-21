# chatslop

A chat app for a small closed group, modelled on T3 Chat.

## People

**User**:
A person with an account, which an Admin created. There is no self-signup.
_Avoid_: Member, account

**Admin**:
A User who can manage Users, Providers, and Models.
_Avoid_: Owner, superuser

## Conversation

**Thread**:
One conversation between a User and Models: an ordered list of Messages.
_Avoid_: Chat, conversation, session

**Message**:
One entry in a Thread, either a Prompt or an Answer.
_Avoid_: Turn, entry

**Prompt**:
A Message the User writes, with any Attachments.
_Avoid_: Question, request, user message

**Answer**:
A Message a Model writes in reply to a Prompt, made with the Model, Reasoning level and Web search chosen for it.
_Avoid_: Response, reply, completion

**Thread search**:
A User searching their own past Threads.
_Avoid_: Chat search, history search

**Attachment**:
A file (image, PDF, or text file) a User adds to their message for the model to read.
_Avoid_: Upload, file, document

**Draft**:
The unsent message in a Thread's composer, with its text and Attachments.
_Avoid_: Unsent message, pending message

**Live answer**:
An answer the model is still writing, which any of the User's open tabs can watch and resume after a reload.
_Avoid_: Draft, stream, pending message

**Context**:
The Messages and Attachments sent to the Model to write one Answer, which may leave out the oldest Messages of the Thread.
_Avoid_: History, memory, context window (that's the Model's limit)

**Web search**:
The model looking things up on the web while it answers.
_Avoid_: Search (unqualified), grounding

## Models

**Provider**:
An API format plus an endpoint and credentials, through which Models are called.
_Avoid_: Backend, vendor

**Model**:
One model, offered through a single Provider, that Users pick for a Thread and can switch between messages.
_Avoid_: Engine, LLM

**Admin-only Model**:
A Model that only Admins can see and use.
_Avoid_: Private model, hidden model

**Reasoning level**:
How hard a Model thinks before answering, chosen per message from the levels that Model supports.
_Avoid_: Effort, thinking budget

**Title Model**:
The Model that writes Thread titles, chosen by an Admin.
_Avoid_: Summarizer

**Favorite**:
A Model a User has starred for quick access in the picker.
_Avoid_: Pinned model, bookmark
