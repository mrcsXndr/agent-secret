I kept pasting API keys into chats with AI agents. Every one of them is still sitting in a transcript somewhere.

So I built agent-secret, a small open-source tool for handing a secret to an agent without it ever touching the chat.

You paste the key into a page that encrypts it in your browser. You get one link for your agent. The agent fetches it once, decrypts it locally and writes it to its .env. After that the link is dead.

The server only stores ciphertext. The decryption key sits after the # in the link, and browsers and HTTP clients never send that part to a server. I can't read your secrets, and neither can anyone who gets hold of the database.

It isn't magic, and the page says so plainly: until your agent claims it, the link is the secret, and single use is best effort. The "How it works" section links the exact lines of code that do the encryption, so you can check instead of trusting me.

One Cloudflare Worker, MIT licensed, self-hostable in a few minutes.

Try it: https://agent-secret.xndr.io
Code: https://github.com/mrcsXndr/agent-secret

If you build with agents, how do you hand them credentials today?

---

Before posting (not part of the post):
1. The repo must be public, or the Code link 404s.
2. Deploy first, then paste https://agent-secret.xndr.io into LinkedIn's Post Inspector (linkedin.com/post-inspector) to confirm the preview image loads. The live robots.txt currently disallows everything, which blocks the preview until this branch is deployed.
