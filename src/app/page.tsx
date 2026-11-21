import { SceneTraceStudio } from "@/components/SceneTraceStudio";
import { getDefaultVideoModel, getShopLocaleDefaults } from "@/lib/env";

export default function HomePage() {
  const defaultVideoModel = getDefaultVideoModel();
  const { country, currency } = getShopLocaleDefaults();

  return (
    <SceneTraceStudio
      defaultVideoModel={defaultVideoModel}
      defaultCountry={country}
      defaultCurrency={currency}
    />
  );
}
