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
One conversation between a User and models: an ordered list of messages.
_Avoid_: Chat, conversation, session

**Thread search**:
A User searching their own past Threads.
_Avoid_: Chat search, history search

**Web search**:
The model looking things up on the web while it answers.
_Avoid_: Search (unqualified), grounding

## Models

**Provider**:
An API format plus an endpoint and credentials, through which Models are called.
_Avoid_: Backend, vendor

**Model**:
One model, offered through a single Provider, that Users can pick for a Thread.
_Avoid_: Engine, LLM
