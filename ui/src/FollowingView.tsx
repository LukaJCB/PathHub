import { Link } from "react-router";
import { useAuthRequired } from "./useAuth";
import { getAllFollowees } from "pathhub-client/src/followRequest.js";


export const FollowingView: React.FC = () => {

    const {user} = useAuthRequired()
    const following = getAllFollowees(user.manifest)
    

    return (
        <div className="min-h-screen bg-gray-50 py-8 px-4">
            <div className="max-w-4xl mx-auto">
                <div className="bg-white rounded-lg shadow-md p-8">
                    <h1 className="text-3xl font-bold text-gray-900 mb-6 flex items-center gap-2">
                        <span>🔗</span> {user.name} Follows
                    </h1>

                    {following.length > 0 ? (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            {following.map(id => (
                                <Link 
                                    key={id} 
                                    to={`/user/${id}/0`}
                                    className="block p-4 bg-gradient-to-r from-green-50 to-emerald-50 border border-green-200 rounded-lg hover:shadow-md transition-shadow"
                                >
                                    <div className="flex items-center gap-3">
                                        <div className="w-10 h-10 rounded-full bg-green-200 flex items-center justify-center text-green-600 font-bold">
                                            {id.charAt(0).toUpperCase()}
                                        </div>
                                        <span className="font-medium text-gray-900 hover:text-green-600 transition-colors">{id}</span>
                                    </div>
                                </Link>
                            ))}
                        </div>
                    ) : (
                        <div className="text-center py-12">
                            <p className="text-gray-500 text-lg">Not following anyone yet</p>
                            <p className="text-gray-400 mt-2">Follow other users to see their activities!</p>
                        </div>
                    )}
                </div>
            </div>
        </div>
    )
}

export default FollowingView