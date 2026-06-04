import { GlobalRegistrator } from "@happy-dom/global-registrator";
import * as React from "react";

GlobalRegistrator.register();

/** Classic JSX runtime for node:test + tsx (Next uses automatic runtime in app build). */
(globalThis as typeof globalThis & { React: typeof React }).React = React;
