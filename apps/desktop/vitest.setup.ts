import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// 未开启 vitest globals，RTL 不会自动清理，需要手动在每个用例后卸载
afterEach(cleanup);
