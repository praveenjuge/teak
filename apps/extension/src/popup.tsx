import { useAuth } from "@clerk/chrome-extension"
import { createMemoryRouter, RouterProvider } from "react-router-dom"

import RootLayout from "~layouts/RootLayout"
import Home from "~routes/Home"
import SignIn from "~routes/SignIn"

import "~style.css"

const router = createMemoryRouter([
  {
    path: "/",
    element: <RootLayout />,
    children: [
      {
        index: true,
        element: <AuthenticatedRoute />
      }
    ]
  }
])

function AuthenticatedRoute() {
  const { isSignedIn } = useAuth()
  
  return isSignedIn ? <Home /> : <SignIn />
}

function IndexPopup() {
  return <RouterProvider router={router} />
}

export default IndexPopup
