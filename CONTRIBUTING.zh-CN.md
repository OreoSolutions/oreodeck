# 为 OreoDeck 做贡献

[English](CONTRIBUTING.md) | [Tiếng Việt](CONTRIBUTING.vi.md) | 简体中文

感谢你帮助改进 OreoDeck。

## 提交拉取请求之前

1. 对重大行为变更，请先创建或引用一个 issue。
2. 保持配置档案隔离、凭据安全和向后兼容性。
3. 为用户可见行为添加或更新测试。
4. 运行相关检查：

   ```bash
   bun run typecheck
   bun run test
   cargo test --manifest-path packages/core-rs/Cargo.toml
   bun run test:app
   bun run lint
   bun run fmt:check
   ```

## 贡献许可

除非另有明确说明，任何有意提交并纳入 OreoDeck 的贡献均按照 Apache-2.0 提供，并遵循该许可证第 5 条。贡献者必须有权提交其代码、文档、设计或其他材料。

请勿提交采用不兼容许可证的复制材料。添加依赖项时，请在 `THIRD_PARTY_NOTICES.md` 中记录名称、版本、许可证和上游来源，并加入二进制再分发所需的文件。

提交拉取请求即表示你确认该贡献是原创作品，或你拥有按照这些条款提交该作品的充分权利。

## 安全问题

不要在公开 issue 中披露凭据或可利用漏洞的细节。请使用仓库的 GitHub 私有安全公告功能。

> 如法律含义存在差异，以英文版本为准。
