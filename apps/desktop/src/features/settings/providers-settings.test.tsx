import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type ProviderSaveInput, setPlatformForTesting } from "@/lib/platform";
import { createMockPlatform, MOCK_BAD_KEY } from "@/lib/platform/mock";
import { strings } from "@/lib/strings";
import { mergeFetched, ProviderSettings } from "./providers-settings";

const t = strings.settings.providers;
const td = t.dialog;
const MODEL_KEYS = ["contextWindow", "id", "input", "maxTokens", "name", "reasoning"];

async function setup({ seedVisible = true }: { seedVisible?: boolean } = {}) {
  const platform = createMockPlatform({ fetchDelayMs: 0 });
  setPlatformForTesting(platform);
  if (seedVisible) {
    const [seed] = await platform.providersList();
    if (!seed) throw new Error("缺少 mock 种子渠道");
    await platform.providerSave({
      name: "Work Gateway",
      api: seed.api,
      baseUrl: seed.baseUrl,
      apiKey: "sk-visible-1234",
      enabled: true,
      models: seed.models,
    });
  }
  const save = vi.spyOn(platform, "providerSave");
  const fetch = vi.spyOn(platform, "providerFetchModels");
  const remove = vi.spyOn(platform, "providerDelete");
  render(<ProviderSettings />);
  return { platform, save, fetch, remove };
}

async function visibleRow(name = "Work Gateway") {
  const list = await screen.findByRole("list", { name: t.title });
  const row = within(list)
    .getAllByRole("listitem")
    .find((li) => li.textContent?.includes(name));
  if (!row) throw new Error(`没有 ${name}`);
  return row;
}

async function openAdd() {
  fireEvent.click(await screen.findByRole("button", { name: t.add }));
  return screen.findByRole("dialog", { name: td.addTitle });
}

function fill(dialog: HTMLElement, label: string, value: string) {
  fireEvent.change(within(dialog).getByLabelText(label), { target: { value } });
}

describe("设置·模型渠道", () => {
  afterEach(() => setPlatformForTesting(undefined));

  it("渠道管理隐藏内置渠道，但模型配置仍包含它的模型", async () => {
    const { platform } = await setup({ seedVisible: false });
    expect(screen.queryByText(t.empty)).toBeNull();
    expect(await screen.findByRole("button", { name: t.add })).toBeTruthy();
    expect(screen.queryByRole("list", { name: t.title })).toBeNull();
    const [ioply] = await platform.providersList();
    expect(ioply).toMatchObject({ id: "ioply", hidden: true });
    expect((await platform.modelsGet()).models.map((m) => m.key)).toContain("ioply/mock-large");
  });

  it("列出用户渠道：协议、接口地址、密钥末 4 位、模型数与启用开关", async () => {
    await setup();
    const row = await visibleRow();
    expect(screen.queryByText("ioply")).toBeNull();
    expect(row.textContent).toContain("OpenAI Responses");
    expect(row.textContent).toContain("https://api.mecode.cc.cd/v1");
    expect(row.textContent).toContain(`${t.key} ••••1234 · 2 个模型`);
    const toggle = within(row).getByRole("switch", {
      name: "启用 Work Gateway",
    }) as HTMLInputElement;
    expect(toggle.checked).toBe(true);
    expect(within(row).getByRole("button", { name: "编辑 Work Gateway" })).toBeTruthy();
    expect(within(row).getByRole("button", { name: "删除 Work Gateway" })).toBeTruthy();
  });

  it("添加渠道：填写、获取模型、勾选并调整参数，保存时只提交契约字段", async () => {
    const { save, fetch } = await setup();
    const dialog = await openAdd();
    fill(dialog, td.name, "  公司网关 ");
    fireEvent.change(within(dialog).getByRole("combobox", { name: td.api }), {
      target: { value: "anthropic-messages" },
    });
    fill(dialog, td.baseUrl, "https://gw.example.com/v1");
    const key = within(dialog).getByLabelText(td.apiKey) as HTMLInputElement;
    expect(key.type).toBe("password");
    expect(key.placeholder).toBe(td.apiKeyPlaceholder);
    fill(dialog, td.apiKey, "sk-test-12345678");

    fireEvent.click(within(dialog).getByRole("button", { name: td.fetch }));
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(fetch).toHaveBeenCalledWith({
      api: "anthropic-messages",
      baseUrl: "https://gw.example.com/v1",
      apiKey: "sk-test-12345678",
    });
    // 新渠道默认全选获取到的模型
    const coder = (await within(dialog).findByRole("checkbox", {
      name: "Mock 编程模型",
    })) as HTMLInputElement;
    expect(coder.checked).toBe(true);
    expect(
      (within(dialog).getByRole("checkbox", { name: td.selectAll }) as HTMLInputElement).checked,
    ).toBe(true);
    fireEvent.click(within(dialog).getByRole("checkbox", { name: "mock-vision" }));
    fireEvent.click(within(dialog).getByRole("checkbox", { name: "Mock 快速模型" }));
    expect(within(dialog).getByText("已选 2 / 4")).toBeTruthy();

    fireEvent.click(within(dialog).getByRole("button", { name: "调整 Mock 编程模型 的参数" }));
    const params = within(dialog).getByRole("group", { name: "调整 Mock 编程模型 的参数" });
    expect((within(params).getByLabelText(td.contextWindow) as HTMLInputElement).value).toBe(
      "128000",
    );
    fireEvent.change(within(params).getByLabelText(td.contextWindow), {
      target: { value: "200000" },
    });
    fireEvent.click(within(params).getByRole("checkbox", { name: td.reasoning }));
    fireEvent.click(within(params).getByRole("checkbox", { name: td.image }));

    fireEvent.click(within(dialog).getByRole("button", { name: td.save }));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    const input = save.mock.calls[0]?.[0] as ProviderSaveInput;
    expect(input).toStrictEqual({
      name: "公司网关",
      api: "anthropic-messages",
      baseUrl: "https://gw.example.com/v1",
      apiKey: "sk-test-12345678",
      enabled: true,
      models: [
        {
          id: "mock-large",
          name: "Mock 大模型",
          reasoning: false,
          input: ["text"],
          contextWindow: 128_000,
          maxTokens: 32_000,
        },
        {
          id: "mock-coder",
          name: "Mock 编程模型",
          reasoning: true,
          input: ["text", "image"],
          contextWindow: 200_000,
          maxTokens: 32_000,
        },
      ],
    });
    expect(Object.keys(input).sort()).toEqual([
      "api",
      "apiKey",
      "baseUrl",
      "enabled",
      "models",
      "name",
    ]);
    for (const m of input.models) expect(Object.keys(m).sort()).toEqual(MODEL_KEYS);

    // 保存后对话框关闭，列表出现新渠道
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    const list = screen.getByRole("list", { name: t.title });
    await waitFor(() => expect(list.textContent).toContain("公司网关"));
    expect(list.textContent).toContain("Anthropic Messages");
    expect(list.textContent).toContain("2 个模型");
  });

  it("编辑渠道：密钥留空不修改，保存参数不含 apiKey；获取模型带渠道 ID 与输入框中的值", async () => {
    const { save, fetch } = await setup();
    fireEvent.click(within(await visibleRow()).getByRole("button", { name: "编辑 Work Gateway" }));
    const dialog = await screen.findByRole("dialog", { name: td.editTitle });
    expect((within(dialog).getByLabelText(td.apiKey) as HTMLInputElement).placeholder).toBe(
      td.apiKeyKeep,
    );
    // 已保存的模型默认勾选
    expect(
      (within(dialog).getByRole("checkbox", { name: "Mock 大模型" }) as HTMLInputElement).checked,
    ).toBe(true);

    fireEvent.click(within(dialog).getByRole("button", { name: td.fetch }));
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(fetch).toHaveBeenCalledWith({
      id: "work-gateway",
      api: "openai-responses",
      baseUrl: "https://api.mecode.cc.cd/v1",
    });
    // 编辑时新获取到的模型默认不选，已保存的保持勾选
    const coder = (await within(dialog).findByRole("checkbox", {
      name: "Mock 编程模型",
    })) as HTMLInputElement;
    expect(coder.checked).toBe(false);

    fill(dialog, td.name, "Work 网关");
    fireEvent.click(within(dialog).getByRole("button", { name: td.save }));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    const input = save.mock.calls[0]?.[0] as ProviderSaveInput;
    expect("apiKey" in input).toBe(false);
    expect(input).toStrictEqual({
      id: "work-gateway",
      name: "Work 网关",
      api: "openai-responses",
      baseUrl: "https://api.mecode.cc.cd/v1",
      enabled: true,
      models: [
        {
          id: "mock-large",
          name: "Mock 大模型",
          reasoning: true,
          input: ["text", "image"],
          contextWindow: 1_000_000,
          maxTokens: 128_000,
        },
        {
          id: "mock-fast",
          name: "Mock 快速模型",
          reasoning: false,
          input: ["text"],
          contextWindow: 128_000,
          maxTokens: 16_384,
        },
      ],
    });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect((await visibleRow("Work 网关")).textContent).toContain("Work 网关");
  });

  it("获取模型失败时在对话框内显示原因", async () => {
    await setup();
    const dialog = await openAdd();
    fill(dialog, td.baseUrl, "https://gw.example.com/v1");
    fill(dialog, td.apiKey, MOCK_BAD_KEY);
    fireEvent.click(within(dialog).getByRole("button", { name: td.fetch }));
    expect((await within(dialog).findByRole("alert")).textContent).toContain(
      "密钥无效或没有权限（HTTP 401）",
    );
    expect(within(dialog).getByText(td.modelsEmpty)).toBeTruthy();
  });

  it("获取前缺少地址或密钥时提示，不发请求", async () => {
    const { fetch } = await setup();
    const dialog = await openAdd();
    fireEvent.click(within(dialog).getByRole("button", { name: td.fetch }));
    expect((await within(dialog).findByRole("alert")).textContent).toContain(td.errors.fetchNeeds);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("保存前校验：名称、接口地址、密钥与模型参数的错误显示在字段下方", async () => {
    const { save, fetch } = await setup();
    const dialog = await openAdd();
    fill(dialog, td.baseUrl, "gw.example.com");
    fireEvent.click(within(dialog).getByRole("button", { name: td.save }));
    expect(await within(dialog).findByText(td.errors.nameRequired)).toBeTruthy();
    expect(within(dialog).getByText(td.errors.baseUrlInvalid)).toBeTruthy();
    expect(within(dialog).getByText(td.errors.apiKeyRequired)).toBeTruthy();
    expect(within(dialog).getByLabelText(td.name).getAttribute("aria-invalid")).toBe("true");

    fill(dialog, td.name, "网关");
    fill(dialog, td.baseUrl, "https://gw.example.com");
    fill(dialog, td.apiKey, "sk-test-12345678");
    fireEvent.click(within(dialog).getByRole("button", { name: td.fetch }));
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    fireEvent.click(await within(dialog).findByRole("button", { name: "调整 Mock 大模型 的参数" }));
    const params = within(dialog).getByRole("group", { name: "调整 Mock 大模型 的参数" });
    fireEvent.change(within(params).getByLabelText(td.maxTokens), { target: { value: "0" } });
    fireEvent.click(within(dialog).getByRole("button", { name: td.save }));
    expect(await within(params).findByText(td.errors.positiveInt)).toBeTruthy();
    expect(save).not.toHaveBeenCalled();
  });

  it("删除前确认，确认后从列表移除", async () => {
    const { remove } = await setup();
    fireEvent.click(within(await visibleRow()).getByRole("button", { name: "删除 Work Gateway" }));
    const dialog = await screen.findByRole("dialog", {
      name: "删除渠道“Work Gateway”？",
    });
    expect(remove).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("button", { name: t.deleteConfirm }));
    await waitFor(() => expect(remove).toHaveBeenCalledWith("work-gateway"));
    expect(screen.queryByText(t.empty)).toBeNull();
    expect(screen.queryByRole("list", { name: t.title })).toBeNull();
  });

  it("停用开关保存 enabled，不带密钥", async () => {
    const { save } = await setup();
    fireEvent.click(within(await visibleRow()).getByRole("switch", { name: "启用 Work Gateway" }));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    const input = save.mock.calls[0]?.[0] as ProviderSaveInput;
    expect(input).toMatchObject({ id: "work-gateway", enabled: false });
    expect("apiKey" in input).toBe(false);
    await waitFor(() =>
      expect(
        (
          within(screen.getByRole("list", { name: t.title })).getByRole("switch", {
            name: "启用 Work Gateway",
          }) as HTMLInputElement
        ).checked,
      ).toBe(false),
    );
  });

  it("后台获取到模型列表（models_watch 推送）后列表随之更新", async () => {
    const { platform } = await setup();
    await visibleRow();
    const work = (await platform.providersList()).find((p) => p.id === "work-gateway");
    if (!work) throw new Error("没有 Work Gateway");
    await act(async () => {
      await platform.providerSave({
        id: work.id,
        name: work.name,
        api: work.api,
        baseUrl: work.baseUrl,
        enabled: true,
        models: [
          ...work.models,
          {
            id: "mock-coder",
            name: "Mock 编程模型",
            reasoning: false,
            input: ["text"],
            contextWindow: 128_000,
            maxTokens: 32_000,
          },
        ],
      });
    });
    await waitFor(async () => expect((await visibleRow()).textContent).toContain("3 个模型"));
  });

  it("合并获取结果：保留已勾选与改过的参数，接口未列出但已勾选的模型保留", () => {
    const fetched = [
      {
        id: "a",
        name: "A",
        reasoning: false,
        input: ["text" as const],
        contextWindow: 1,
        maxTokens: 1,
      },
      {
        id: "b",
        name: "B",
        reasoning: false,
        input: ["text" as const],
        contextWindow: 1,
        maxTokens: 1,
      },
    ];
    const first = mergeFetched([], fetched);
    expect(first.map((d) => [d.id, d.selected])).toEqual([
      ["a", true],
      ["b", true],
    ]);
    const prev = [
      { ...first[0], contextWindow: "99", selected: true } as (typeof first)[0],
      { ...first[1], selected: false } as (typeof first)[0],
      { ...first[0], id: "gone", selected: true } as (typeof first)[0],
      { ...first[0], id: "dropped", selected: false } as (typeof first)[0],
    ];
    const merged = mergeFetched(prev, [
      ...fetched,
      { ...fetched[0], id: "c" } as (typeof fetched)[0],
    ]);
    expect(merged.map((d) => [d.id, d.selected, d.listed])).toEqual([
      ["a", true, true],
      ["b", false, true],
      ["c", false, true],
      ["gone", true, false],
    ]);
    expect(merged[0]?.contextWindow).toBe("99");
  });

  it("获取时，能力仍是默认参数的已有模型按新结果重新识别（名称与勾选保留），改过的不动", () => {
    const recognized = {
      id: "kimi-k3.1-pro",
      name: "kimi-k3.1-pro",
      reasoning: true,
      input: ["text" as const, "image" as const],
      contextWindow: 1_048_576,
      maxTokens: 131_072,
    };
    const prev = [
      {
        id: "kimi-k3.1-pro",
        name: "我的 Kimi",
        reasoning: false,
        image: false,
        contextWindow: "128000",
        maxTokens: "32000",
        selected: true,
        listed: true,
      },
      {
        id: "edited",
        name: "Edited",
        reasoning: false,
        image: false,
        contextWindow: "64000",
        maxTokens: "32000",
        selected: false,
        listed: true,
      },
    ];
    const merged = mergeFetched(prev, [recognized, { ...recognized, id: "edited", name: "E" }]);
    expect(merged[0]).toEqual({
      id: "kimi-k3.1-pro",
      name: "我的 Kimi",
      reasoning: true,
      image: true,
      contextWindow: "1048576",
      maxTokens: "131072",
      selected: true,
      listed: true,
    });
    expect(merged[1]).toEqual({ ...prev[1], listed: true });
  });
});
