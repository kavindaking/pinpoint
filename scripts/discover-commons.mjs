const queries = process.argv.slice(2);

for (const query of queries) {
  const params = new URLSearchParams({
    action: "query",
    format: "json",
    formatversion: "2",
    generator: "search",
    gsrsearch: query,
    gsrnamespace: "6",
    gsrlimit: "4",
    prop: "imageinfo",
    iiprop: "url|mime|extmetadata",
    iiurlwidth: "500",
    origin: "*",
  });
  let data;
  for (let attempt = 0; attempt < 4; attempt++) {
    const response = await fetch(`https://commons.wikimedia.org/w/api.php?${params}`, {
      headers: { "User-Agent": "PinpointRadiology/1.0 (educational case curation)" },
    });
    if (response.ok) {
      data = await response.json();
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 2000 * (attempt + 1)));
  }
  if (!data) {
    console.log(JSON.stringify({ query, results: [], error: "API request failed" }));
    continue;
  }
  const results = (data.query?.pages ?? []).map((page) => {
    const info = page.imageinfo?.[0] ?? {};
    const metadata = info.extmetadata ?? {};
    return {
      title: page.title,
      mime: info.mime,
      thumb: info.thumburl,
      page: info.descriptionurl,
      license: metadata.LicenseShortName?.value,
      artist: metadata.Artist?.value?.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim(),
      description: metadata.ImageDescription?.value
        ?.replace(/<[^>]*>/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 220),
    };
  });
  console.log(JSON.stringify({ query, results }));
  await new Promise((resolve) => setTimeout(resolve, 1200));
}
