import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import LanguageSwitchView from "./LanguageSwitchView.js";

describe("LanguageSwitchView", () => {
    it("renders accessible locale toggle controls and reflects the active locale", () => {
        const markup = renderToStaticMarkup(
            <LanguageSwitchView
                locale="vi"
                onLocaleChange={() => undefined}
                label="Language"
                englishLabel="English"
                vietnameseLabel="Vietnamese"
            />,
        );

        assert.match(markup, /role="group"/);
        assert.match(markup, /aria-label="Language"/);
        assert.match(markup, /aria-pressed="false"[^>]*>en</i);
        assert.match(markup, /aria-pressed="true"[^>]*>vi</i);
    });
});
