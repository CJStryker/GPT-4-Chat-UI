// Import styles and the main CSS file
import '../styles/globals.css'
// Import the Head component from Next.js to handle meta tags
import Head from 'next/head'

// Define the App component, which acts as a wrapper for all your pages
export default function App({ Component, pageProps }) {
  // Use the Component and pageProps passed as props to render your pages
  return (
    <>
      {/* Add meta tags to the page */}
      <Head>
        <title>PopPooB</title>
        <link rel="icon" href="/favicon.ico" />
      </Head>
      {/* Render the Component with props */}
      <Component {...pageProps} />
    </>
  )
}