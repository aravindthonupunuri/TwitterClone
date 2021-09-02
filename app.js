const express = require("express");
const { open } = require("sqlite");
const sqlite3 = require("sqlite3");
const path = require("path");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");

const databasePath = path.join(__dirname, "twitterClone.db");

const app = express();

app.use(express.json());

let database = null;

const initializeDbAndServer = async () => {
  try {
    database = await open({
      filename: databasePath,
      driver: sqlite3.Database,
    });

    app.listen(3000, () =>
      console.log("Server Running at http://localhost:3000/")
    );
  } catch (error) {
    console.log(`DB Error: ${error.message}`);
    process.exit(1);
  }
};

initializeDbAndServer();

const validatePassword = (password) => {
  return password.length > 5;
};
//authToken
function authenticateToken(request, response, next) {
  let jwtToken;
  const authHeader = request.headers["authorization"];
  if (authHeader !== undefined) {
    jwtToken = authHeader.split(" ")[1];
  }
  if (jwtToken === undefined) {
    response.status(401);
    response.send("Invalid JWT Token");
  } else {
    jwt.verify(jwtToken, "MY_SECRET_TOKEN", async (error, payload) => {
      if (error) {
        response.status(401);
        response.send("Invalid JWT Token");
      } else {
        request.username = payload.username;
        next();
      }
    });
  }
}
//user register
app.post("/register/", async (request, response) => {
  const { username, name, password, gender } = request.body;
  const hashedPassword = await bcrypt.hash(password, 10);
  const selectUserQuery = `SELECT * FROM user WHERE username = '${username}';`;
  const databaseUser = await database.get(selectUserQuery);

  if (databaseUser === undefined) {
    const createUserQuery = `
     INSERT INTO
      user (username, name, password, gender)
     VALUES
      (
       '${username}',
       '${name}',
       '${hashedPassword}',
       '${gender}' 
      );`;
    if (validatePassword(password)) {
      await database.run(createUserQuery);
      response.send("User created successfully");
    } else {
      response.status(400);
      response.send("Password is too short");
    }
  } else {
    response.status(400);
    response.send("User already exists");
  }
});
//user login
app.post("/login/", async (request, response) => {
  const { username, password } = request.body;
  const selectUserQuery = `SELECT * FROM user WHERE username = '${username}';`;
  const databaseUser = await database.get(selectUserQuery);
  if (databaseUser === undefined) {
    response.status(400);
    response.send("Invalid user");
  } else {
    const isPasswordMatched = await bcrypt.compare(
      password,
      databaseUser.password
    );
    if (isPasswordMatched === true) {
      const payload = {
        username: username,
      };
      const jwtToken = jwt.sign(payload, "MY_SECRET_TOKEN");
      response.send({ jwtToken });
    } else {
      response.status(400);
      response.send("Invalid password");
    }
  }
});
//tweets of following people
app.get("/user/tweets/feed/", authenticateToken, async (request, response) => {
  let { username } = request;
  const getTweets = `
    SELECT
      user.username,
      tweet.tweet,
      tweet.date_time AS dateTime
    FROM
      user INNER JOIN tweet 
      ON user.user_id = tweet.user_id
      
      WHERE user.user_id 
      IN (SELECT following_user_id FROM follower
         WHERE follower_user_id 
      IN (SELECT user_id FROM user WHERE username = '${username}'))
      
      ORDER BY date_time DESC
      LIMIT 4;`;
  const tweetsArray = await database.all(getTweets);
  response.send(tweetsArray);
});
//following users
app.get("/user/following/", authenticateToken, async (request, response) => {
  let { username } = request;
  const getNames = `
    SELECT
      user.name
    FROM
      user INNER JOIN follower ON user.user_id = follower.following_user_id
      WHERE follower.follower_user_id IN (SELECT user_id FROM user WHERE username = '${username}');`;
  const namesArray = await database.all(getNames);
  response.send(namesArray);
});
//followers of user
app.get("/user/followers/", authenticateToken, async (request, response) => {
  let { username } = request;
  const getFollowers = `
    SELECT
      user.name
    FROM
      user INNER JOIN follower ON user.user_id = follower.follower_user_id
      WHERE follower.following_user_id IN (SELECT user_id FROM user WHERE username = '${username}');`;
  const followersArray = await database.all(getFollowers);

  response.send(followersArray);
});
//checks if user follows the tweet_id
const follow = async (request, response, next) => {
  let { username } = request;
  let { tweetId } = request.params;
  const getTweetIds = `
    SELECT tweet.tweet_id FROM tweet 
    WHERE tweet.user_id 
      IN (SELECT following_user_id FROM follower
         WHERE follower_user_id 
      IN (SELECT user_id FROM user WHERE username = '${username}'));`;

  const tweetIds = await database.all(getTweetIds);
  const tweetObj = tweetIds.find((tweet) => {
    if (parseInt(tweet.tweet_id) === parseInt(tweetId)) {
      return tweet;
    }
  });
  if (tweetObj === undefined) {
    response.status(401);
    response.send("Invalid Request");
  } else {
    next();
  }
};
//get tweets only if user follows
app.get(
  "/tweets/:tweetId/",
  authenticateToken,
  follow,
  async (request, response) => {
    let { username } = request;
    let { tweetId } = request.params;

    const { tweet, date_time } = await database.get(
      `SELECT tweet,date_time FROM tweet WHERE tweet_id = '${tweetId}';`
    );
    const { likes } = await database.get(
      `SELECT COUNT(like_id) AS likes FROM like WHERE tweet_id = '${tweetId}';`
    );
    console.log(likes);
    const { replies } = await database.get(
      `SELECT COUNT(reply_id) AS replies FROM reply WHERE tweet_id = '${tweetId}';`
    );
    console.log(replies);
    response.send({
      tweet,
      likes,
      replies,
      dateTime: date_time,
    });
  }
);

//list of usernames who liked the tweet
app.get(
  "/tweets/:tweetId/likes/",
  authenticateToken,
  follow,
  async (request, response) => {
    let { username } = request;
    let { tweetId } = request.params;

    const likedNamesQuery = `SELECT  user.username FROM like NATURAL JOIN user
     WHERE tweet_id = ${tweetId} `;
    const likedNames = await database.all(likedNamesQuery);
    console.log(likedNames);
    const likes = likedNames.map((each) => each.username);

    response.send({
      likes,
    });
  }
);

//List of replies
app.get(
  "/tweets/:tweetId/replies/",
  authenticateToken,
  follow,
  async (request, response) => {
    let { username } = request;
    let { tweetId } = request.params;

    const repliedQuery = `SELECT  user.name, reply FROM reply NATURAL JOIN user
     WHERE tweet_id = ${tweetId} `;
    const repliedNames = await database.all(repliedQuery);
    console.log(repliedNames);
    const replies = repliedNames.map((each) => each);

    response.send({ replies });
  }
);
//list of all tweets of user
app.get("/user/tweets/", authenticateToken, async (request, response) => {
  let { username } = request;
  let tweetsQuery = `SELECT tweet.tweet, 
  COUNT(DISTINCT like_id) AS likes,
  COUNT(DISTINCT reply_id) AS replies,
  tweet.date_time AS dateTime 
  FROM tweet INNER JOIN like ON tweet.tweet_id = like.tweet_id
  INNER JOIN reply ON tweet.tweet_id = reply.tweet_id 
  WHERE tweet.user_id IN (SELECT user_id FROM user WHERE username = '${username}')
  GROUP BY tweet.tweet_id;`;
  let tweets = await database.all(tweetsQuery);
  response.send(tweets);
});
//add tweet
app.post("/user/tweets/", authenticateToken, async (request, response) => {
  let { tweet } = request.body;
  let { username } = request;
  const { user_id } = await database.get(
    `SELECT user_id FROM user WHERE username = '${username}'`
  );

  const postQuery = `INSERT INTO tweet (tweet,user_id)
  VALUES ('${tweet}',${user_id});`;
  const post = await database.run(postQuery);
  response.send("Created a Tweet");
});
// Delete tweet
app.delete(
  "/tweets/:tweetId/",
  authenticateToken,
  async (request, response) => {
    let { username } = request;
    let { tweetId } = request.params;
    const userQuery = `SELECT tweet_id,user_id 
    FROM tweet WHERE tweet_id = '${tweetId}'
    AND user_id = (SELECT user_id FROM user WHERE username = '${username}');`;

    const userTweet = await database.get(userQuery);
    if (userTweet === undefined) {
      response.status(401);
      response.send("Invalid Request");
    } else {
      const delQuery = `DELETE FROM tweet WHERE tweet_id = '${tweetId}';`;
      await database.run(delQuery);
      response.send("Tweet Removed");
    }
  }
);
module.exports = app;
