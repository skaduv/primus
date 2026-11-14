#!/usr/bin/env bash
# 把一个版本的 2 个 MSI 与 2 个 exe 安装程序 PrimusSetup_<ver>_<x64|arm64>_zh-CN.exe（ADR 0011）发布到指定仓库的 GitHub Release（release.yml 的发布作业调用，ADR 0009）。
# 先发到源码仓 skaduv/primus，再用同一脚本同步到公开发布仓 skaduv/primus-releases，两边附件与正文一致。
#
# 环境变量：
#   GH_REPO       目标仓库（owner/name）        GH_TOKEN    对该仓库有 Contents 写权限的令牌
#   RELEASE_TAG   标签（v0.1.0）                VERSION     版本（0.1.0）
#   PRERELEASE    true / false                  ASSETS_DIR  含 2 个 MSI（与 exe 安装程序）的目录（默认 assets）
#   SUMS_FILE     sha256sum 格式的校验清单（默认 SHA256SUMS.txt，需含每个附件的行）
#   REQUIRE_SETUP_EXE  1 = 两个 exe 安装程序都必须有（发布工作流）；否则目录里有哪个发哪个（回填早于它的版本时没有）
#
# Release 不存在则创建；已存在则覆盖同名附件（上传失败回滚）、替换正文的「已知限制」「安装包」「校验」三段、
# 更正 prerelease / Latest，最后删除不在清单中的旧附件。结束前核对状态与附件清单。
# 自动更新清单 update-feed 只在公开仓维护，不由本脚本处理；“update-feed 已引用本标签时不能原地重建”的检查
# 在调用本脚本之前单独做。
set -euo pipefail

: "${GH_REPO:?缺少 GH_REPO}" "${GH_TOKEN:?缺少 GH_TOKEN}" "${RELEASE_TAG:?缺少 RELEASE_TAG}"
: "${VERSION:?缺少 VERSION}" "${PRERELEASE:?缺少 PRERELEASE}"
ASSETS_DIR="${ASSETS_DIR:-assets}"
SUMS_FILE="$(realpath "${SUMS_FILE:-SHA256SUMS.txt}")"
export GH_REPO GH_TOKEN

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

names=(
  "Primus_${VERSION}_x64_zh-CN.msi"
  "Primus_${VERSION}_arm64_zh-CN.msi"
)
setup_x64="PrimusSetup_${VERSION}_x64_zh-CN.exe"
setup_arm64="PrimusSetup_${VERSION}_arm64_zh-CN.exe"
setups=()
for n in "$setup_x64" "$setup_arm64"; do
  if [[ "${REQUIRE_SETUP_EXE:-0}" == "1" || -f "${ASSETS_DIR}/${n}" ]]; then
    names+=("$n")
    setups+=("$n")
  fi
done
# 只上传安装包；.sig 内联进 update-feed 清单
files=()
for n in "${names[@]}"; do
  [[ -f "${ASSETS_DIR}/${n}" ]] || { echo "::error::缺少附件 ${ASSETS_DIR}/${n}"; exit 1; }
  files+=("${ASSETS_DIR}/${n}")
done

retry() {
  local i
  for i in 1 2 3; do
    "$@" && return 0
    echo "::warning::第 ${i} 次失败：$*" >&2
    sleep $((i * 10))
  done
  return 1
}

# 正文的「## 校验」段：全部附件的 SHA-256
{
  printf '## 校验\n\n| 文件 | SHA-256 |\n| --- | --- |\n'
  for n in "${names[@]}"; do
    printf '| `%s` | `%s` |\n' "$n" "$(awk -v n="$n" '$2 == n || $2 == "*" n { print $1 }' "$SUMS_FILE")"
  done
  printf '\n```powershell\nGet-FileHash .\\<文件名> -Algorithm SHA256\n```\n'
} > "$work/checksums.md"
if grep -Eq '\| `[0-9a-f]{0,63}` \|' "$work/checksums.md"; then echo "::error::校验表缺少哈希"; exit 1; fi

# 正文的「## 已知限制」与「## 安装包」段：创建时写入，更新已有 Release 时整段替换
{
  printf '## 已知限制\n\n'
  printf -- '- **未做代码签名**：首次运行安装包时 Windows SmartScreen 会拦截，需要点「更多信息」→「仍要运行」。\n'
} > "$work/limits.md"
{
  printf '## 安装包\n\n'
  if [[ ${#setups[@]} -gt 0 ]]; then
    list="$(printf '`%s`、' "${setups[@]}")"
    printf -- '- %s：**exe 安装程序（推荐）**，按电脑架构选一个：大多数电脑用 x64，骁龙等 ARM 笔记本用 arm64（下错了安装程序会提示）。双击 `.msi` 提示「无法识别此类型的文件」或打不开时用它，装好后与直接装 MSI 完全相同\n' "${list%、}"
  fi
  printf -- '- `%s`、`%s`：MSI 安装包（简体中文，x64 / ARM64），按机器安装，之后的版本在退出 Primus 时静默更新\n' "${names[0]}" "${names[1]}"
  printf -- '- 之前装过 NSIS 版（`Primus_<版本>_x64-setup.exe`）的电脑：运行一次新版本的安装程序或 MSI 即可，会自动卸载 NSIS 版并沿用原来的数据\n'
  printf -- '- 应用内自动更新的签名直接写在更新清单里，不再单独提供 `.sig` 附件\n'
} > "$work/packages.md"

# 只有预发布版本标 prerelease；正式版取消 prerelease 并设为 Latest
if [[ "$PRERELEASE" == "true" ]]; then
  channel=(--prerelease --latest=false)
else
  channel=(--prerelease=false --latest)
fi

if gh release view "$RELEASE_TAG" --json id >/dev/null 2>&1; then
  echo "${GH_REPO}：Release ${RELEASE_TAG} 已存在，更新附件（prerelease=${PRERELEASE}）"
  existing="$(gh release view "$RELEASE_TAG" --json assets --jq '.assets[].name')"
  # --clobber 先删旧附件再上传：先备份同名旧附件，上传失败时整组回滚，避免 Release 缺安装包
  mkdir -p "$work/backup"
  for n in "${names[@]}"; do
    if grep -Fxq -- "$n" <<<"$existing"; then
      gh release download "$RELEASE_TAG" --pattern "$n" --dir "$work/backup"
    fi
  done
  if ! gh release upload "$RELEASE_TAG" "${files[@]}" --clobber; then
    echo "::error::${GH_REPO}：附件上传失败，回滚到上传前的附件"
    for n in "${names[@]}"; do
      if [[ -f "$work/backup/$n" ]]; then
        gh release upload "$RELEASE_TAG" "$work/backup/$n" --clobber || echo "::error::恢复旧附件 $n 失败"
      elif gh release view "$RELEASE_TAG" --json assets --jq '.assets[].name' | grep -Fxq -- "$n"; then
        # 上传前不存在的附件：删掉本次留下的新版本，保持整组一致
        gh release delete-asset "$RELEASE_TAG" "$n" --yes || echo "::error::删除新附件 $n 失败"
      fi
    done
    exit 1
  fi
  # 新附件齐全后先更新正文与发布状态（有限重试，仍失败则失败），全部成功后才删除不在本次清单中的旧附件
  # （例如早期发布的 SBOM 与 .sha256）：中途失败时旧附件仍在，重新运行工作流即可恢复
  # 正文：替换「## 已知限制」「## 安装包」「## 校验」三段（各到下一个二级标题或结尾为止）；
  # 前两段没有则加在正文开头，校验段没有则追加；其余正文（手动补充的变更说明等）不动
  retry gh release view "$RELEASE_TAG" --json body --jq .body > "$work/body.md" \
    || { echo "::error::读取 Release 正文失败"; exit 1; }
  LIMITS="$(cat "$work/limits.md")" PACKAGES="$(cat "$work/packages.md")" CHECKSUMS="$(cat "$work/checksums.md")" perl -0pi -e '
    my $head = "";
    for my $pair (["已知限制", $ENV{LIMITS}], ["安装包", $ENV{PACKAGES}]) {
      my ($title, $text) = @$pair;
      my $section = "$text\n\n";
      $head .= $section unless s/^##[ \t]*\Q$title\E[ \t]*\r?\n.*?(?=^##[ \t]|\z)/$section/ms;
    }
    $_ = $head . $_ if $head ne "";
    my $section = "$ENV{CHECKSUMS}\n\n";
    if (!s/^##[ \t]*校验[ \t]*\r?\n.*?(?=^##[ \t]|\z)/$section/ms) {
      s/\s*\z/\n\n$section/;
    }
    s/\s*\z/\n/;
  ' "$work/body.md"
  retry gh release edit "$RELEASE_TAG" --draft=false "${channel[@]}" --notes-file "$work/body.md" \
    || { echo "::error::更新 Release 正文与发布状态失败，旧附件保留"; exit 1; }
  while IFS= read -r old; do
    [[ -z "$old" ]] && continue
    if ! printf '%s\n' "${names[@]}" | grep -Fxq -- "$old"; then
      echo "删除不在清单中的旧附件：$old"
      retry gh release delete-asset "$RELEASE_TAG" "$old" --yes \
        || { echo "::error::删除旧附件 $old 失败"; exit 1; }
    fi
  done <<<"$existing"
else
  echo "${GH_REPO}：Release ${RELEASE_TAG} 不存在，创建（prerelease=${PRERELEASE}）"
  {
    cat "$work/limits.md"
    printf '\n'
    cat "$work/packages.md"
    printf '\n'
    cat "$work/checksums.md"
  } > "$work/notes.md"
  # 源码仓已有该标签，--target 被忽略；公开仓没有源码标签，按其 main 新建同名标签
  gh release create "$RELEASE_TAG" "${files[@]}" \
    --target main \
    --title "乾元 Primus ${VERSION}" \
    --notes-file "$work/notes.md" \
    "${channel[@]}"
fi

# 核对发布结果：非草稿、prerelease 正确、附件与清单一致、正式版为 Latest
gh release view "$RELEASE_TAG" --json isDraft,isPrerelease,assets \
  --jq '"draft=\(.isDraft) prerelease=\(.isPrerelease)", (.assets[] | "\(.name)\t\(.size)")'
state="$(gh release view "$RELEASE_TAG" --json isDraft,isPrerelease --jq '"\(.isDraft) \(.isPrerelease)"')"
[[ "$state" == "false ${PRERELEASE}" ]] || { echo "::error::${GH_REPO}：Release 状态不符（draft prerelease = ${state}）"; exit 1; }
actual="$(gh release view "$RELEASE_TAG" --json assets --jq '.assets[].name' | LC_ALL=C sort)"
expected="$(printf '%s\n' "${names[@]}" | LC_ALL=C sort)"
[[ "$actual" == "$expected" ]] || { echo "::error::${GH_REPO}：Release 附件与清单不符：${actual}"; exit 1; }
if [[ "$PRERELEASE" != "true" ]]; then
  latest="$(gh api "repos/${GH_REPO}/releases/latest" --jq .tag_name)"
  [[ "$latest" == "$RELEASE_TAG" ]] || { echo "::error::${GH_REPO}：Latest 为 ${latest}，不是 ${RELEASE_TAG}"; exit 1; }
fi
echo "✓ ${GH_REPO} ${RELEASE_TAG}"
