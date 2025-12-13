import { FormEvent, useState } from "react";
import {AuthenticationClient, createAuthClient} from "pathhub-client/src/authClient.js"
import { Link, useNavigate } from "react-router";


const RegistrationView: React.FC = () => {

    const [username, setUsername] = useState("");
    const [password, setPassword] = useState("");
    const nav = useNavigate()

    const authClient: AuthenticationClient = createAuthClient("/auth")

    async function handleSubmit(e: FormEvent) {
        e.preventDefault();
        await authClient.register({username, password})
        nav("/login")
    }

    
    return (<>
    <h2>Registration</h2><form onSubmit={handleSubmit}>
      <label>Username:
      </label>
        <input
          type="text" 
          value={username}
          onChange={(e) => setUsername(e.target.value)}
        />
      <label>Password:
      </label>
        <input
          type="password" 
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      <input type="submit" value={"Register"} />
    </form>
    <div>Already have an account? <Link to="/login">Click here to Login!</Link>
        </div></>)
}

export default RegistrationView