import type { Meta } from "@storybook/react-vite";
import { MemoryRouter } from "react-router-dom";
import { Login } from "./login";
import { Register } from "./register";

const HS = "https://matrix.example.org";

/** Answers the two homeserver probes the sign-in screens make, so no server is needed. */
function stubHomeserver(opts: { sso?: boolean; password?: boolean; registration?: boolean }) {
  const flows = [
    ...(opts.password === false ? [] : [{ type: "m.login.password" }]),
    ...(opts.sso ? [{ type: "m.login.sso", identity_providers: [{ id: "github", name: "GitHub" }] }] : []),
  ];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith("/register")) {
      return opts.registration
        ? new Response(JSON.stringify({ session: "s", flows: [{ stages: ["m.login.dummy"] }] }), { status: 401 })
        : new Response(JSON.stringify({ errcode: "M_FORBIDDEN" }), { status: 403 });
    }
    return new Response(JSON.stringify({ flows }), { status: 200 });
  }) as typeof fetch;
}

const meta = {
  title: "Auth/Sign in",
  parameters: { layout: "fullscreen" },
  decorators: [
    (Story) => (
      <MemoryRouter>
        <Story />
      </MemoryRouter>
    ),
  ],
} satisfies Meta;

export default meta;

export const Password = {
  render() {
    stubHomeserver({ registration: true });
    return <Login homeserverUrl={HS} defaultIdpLabel={null} />;
  },
};

export const PasswordAndSso = {
  render() {
    stubHomeserver({ sso: true, registration: true });
    return <Login homeserverUrl={HS} defaultIdpLabel={null} />;
  },
};

export const SsoOnly = {
  render() {
    stubHomeserver({ sso: true, password: false });
    return <Login homeserverUrl={HS} defaultIdpLabel={null} />;
  },
};

export const CreateAccount = {
  render() {
    stubHomeserver({ registration: true });
    return <Register homeserverUrl={HS} />;
  },
};
