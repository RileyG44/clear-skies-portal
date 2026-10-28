/* The one place browser tools find Playwright: PLAYWRIGHT_MODULE if set,
   otherwise the project's playwright-core (npm ci). Chrome runs from the
   installed Google Chrome (channel "chrome"); WebKit needs its browser once:
   npx playwright-core install webkit */
module.exports=require(process.env.PLAYWRIGHT_MODULE||"playwright-core");
